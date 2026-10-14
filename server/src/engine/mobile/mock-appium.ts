/**
 * Mock Appium (MockMobileDriverProvider): server W3C/Appium tiruan di dalam
 * Testora yang meniru sebuah aplikasi Android kecil "Demo Shop" (layar login →
 * daftar pesanan yang bisa digulir). Dipakai oleh Mock Mode (development /
 * demo tanpa perangkat) dan oleh test otomatis. Bukan perangkat sungguhan.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import express from 'express';

const KEY = 'element-6066-11e4-a52e-4f735466cecf';

interface El {
  id: string;
  cls: string;
  resourceId?: string;
  desc?: string;
  text?: string;
  password?: boolean;
  bounds: [number, number, number, number];
  displayed?: boolean;
}

/** Gambar PNG sungguhan (RGB, tanpa library) dari kotak-kotak berwarna. */
export function renderPng(
  width: number,
  height: number,
  boxes: {
    x: number;
    y: number;
    width: number;
    height: number;
    color: [number, number, number];
    border?: [number, number, number];
  }[],
  background: [number, number, number] = [246, 247, 251],
): string {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) raw.set(background, y * row + 1 + x * 3);
  }
  for (const b of boxes) {
    const x1 = Math.max(0, Math.round(b.x));
    const y1 = Math.max(0, Math.round(b.y));
    const x2 = Math.min(width, Math.round(b.x + b.width));
    const y2 = Math.min(height, Math.round(b.y + b.height));
    for (let y = y1; y < y2; y++)
      for (let x = x1; x < x2; x++) {
        const edge = b.border && (x < x1 + 2 || x >= x2 - 2 || y < y1 + 2 || y >= y2 - 2);
        raw.set(edge ? b.border! : b.color, y * row + 1 + x * 3);
      }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

/** PNG kosong dengan ukuran tertentu (dipakai test). */
export const fakePng = (width: number, height: number) => renderPng(width, height, []);

export function mockAppium() {
  const state = {
    sessions: [] as { id: string; caps: Record<string, unknown>; deleted: boolean }[],
    screen: 'login' as 'login' | 'orders',
    email: '',
    password: '',
    /** Seberapa jauh daftar pesanan digulir (per swipe 10 item). */
    scroll: 0,
    gestures: [] as unknown[],
    scripts: [] as string[],
    keyboard: false,
    failCreate: '',
  };

  const elements = (): El[] => {
    if (state.screen === 'login')
      return [
        { id: 'e-title', cls: 'android.widget.TextView', text: 'Demo Shop', bounds: [0, 100, 1080, 200] },
        {
          id: 'e-email',
          cls: 'android.widget.EditText',
          resourceId: 'com.demo:id/email',
          text: state.email,
          bounds: [60, 400, 1020, 520],
        },
        {
          id: 'e-pass',
          cls: 'android.widget.EditText',
          resourceId: 'com.demo:id/password',
          text: state.password ? '••••' : '',
          password: true,
          bounds: [60, 560, 1020, 680],
        },
        {
          id: 'e-login',
          cls: 'android.widget.Button',
          desc: 'login',
          text: 'Sign in',
          bounds: [60, 760, 1020, 880],
        },
      ];
    const orders: El[] = [];
    // 10 pesanan terlihat, mulai dari posisi gulir.
    for (let i = 1; i <= 40; i++) {
      const row = i - 1 - state.scroll;
      orders.push({
        id: `e-order-${i}`,
        cls: 'android.widget.TextView',
        resourceId: 'com.demo:id/order',
        text: `Order ${i} - Paid`,
        bounds: [0, 400 + row * 180, 1080, 560 + row * 180],
        displayed: row >= 0 && row < 10,
      });
    }
    return [
      {
        id: 'e-welcome',
        cls: 'android.widget.TextView',
        resourceId: 'com.demo:id/welcome',
        text: `Welcome ${state.email}`,
        bounds: [0, 100, 1080, 200],
      },
      ...orders,
    ];
  };

  const find = (using: string, value: string): El[] => {
    const all = elements();
    const ui = /UiSelector\(\)\.(text|textContains)\("((?:[^"\\]|\\.)*)"\)/.exec(value);
    const xp = /^\/\/([\w.]+)\[@([\w-]+)="([^"]*)"\]$/.exec(value);
    switch (using) {
      case 'accessibility id':
        return all.filter((e) => e.desc === value);
      case 'id':
        return all.filter((e) => e.resourceId === value);
      case '-android uiautomator':
        if (!ui) return [];
        return all.filter((e) => (ui[1] === 'text' ? e.text === ui[2] : (e.text ?? '').includes(ui[2])));
      case 'xpath':
        if (!xp) return [];
        return all.filter((e) => {
          const attr = { 'resource-id': e.resourceId, text: e.text, 'content-desc': e.desc }[xp[2]];
          return e.cls === xp[1] && attr === xp[3];
        });
      default:
        return [];
    }
  };

  const source = () =>
    `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0"><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2340]" displayed="true">` +
    elements()
      .map(
        (e) =>
          `<${e.cls} class="${e.cls}" package="com.demo" text="${e.text ?? ''}" resource-id="${e.resourceId ?? ''}" content-desc="${e.desc ?? ''}" clickable="${e.cls !== 'android.widget.TextView'}" enabled="true" password="${!!e.password}" displayed="${e.displayed !== false}" bounds="[${e.bounds[0]},${e.bounds[1]}][${e.bounds[2]},${e.bounds[3]}]" />`,
      )
      .join('') +
    `</android.widget.FrameLayout></hierarchy>`;

  const app = express();
  app.use(express.json());
  const noSuch = (res: express.Response, what = 'element') =>
    res.status(404).json({ value: { error: `no such ${what}`, message: `An ${what} could not be located` } });
  const byId = (id: string) => elements().find((e) => e.id === id);

  app.get('/status', (_req, res) => res.json({ value: { ready: true, build: { version: '2.11.0' } } }));
  app.post('/session', (req, res) => {
    if (state.failCreate)
      return res.status(500).json({ value: { error: 'session not created', message: state.failCreate } });
    const id = `s${state.sessions.length + 1}`;
    const caps = req.body.capabilities.alwaysMatch;
    state.sessions.push({ id, caps, deleted: false });
    state.screen = 'login';
    state.email = '';
    state.password = '';
    state.scroll = 0;
    res.json({
      value: { sessionId: id, capabilities: { ...caps, platformVersion: '14', deviceModel: 'Pixel 7' } },
    });
  });
  app.delete('/session/:s', (req, res) => {
    const s = state.sessions.find((x) => x.id === req.params.s);
    if (s) s.deleted = true;
    res.json({ value: null });
  });
  app.use('/session/:s', (req, res, next) => {
    const s = state.sessions.find((x) => x.id === req.params.s);
    if (!s || s.deleted)
      return res.status(404).json({ value: { error: 'invalid session id', message: 'gone' } });
    next();
  });
  app.post('/session/:s/element', (req, res) => {
    const found = find(req.body.using, req.body.value);
    found.length ? res.json({ value: { [KEY]: found[0].id } }) : noSuch(res);
  });
  app.post('/session/:s/elements', (req, res) =>
    res.json({
      value: find(req.body.using, req.body.value)
        .filter((e) => e.displayed !== false)
        .map((e) => ({ [KEY]: e.id })),
    }),
  );
  app.post('/session/:s/element/:e/click', (req, res) => {
    const e = byId(req.params.e);
    if (!e) return noSuch(res);
    if (e.cls === 'android.widget.EditText') state.keyboard = true;
    if (e.id === 'e-login' && state.email && state.password) state.screen = 'orders';
    res.json({ value: null });
  });
  app.post('/session/:s/element/:e/clear', (req, res) => {
    if (req.params.e === 'e-email') state.email = '';
    if (req.params.e === 'e-pass') state.password = '';
    res.json({ value: null });
  });
  app.post('/session/:s/element/:e/value', (req, res) => {
    if (req.params.e === 'e-email') state.email += req.body.text;
    if (req.params.e === 'e-pass') state.password += req.body.text;
    res.json({ value: null });
  });
  app.get('/session/:s/element/:e/text', (req, res) => {
    const e = byId(req.params.e);
    e ? res.json({ value: e.text ?? '' }) : noSuch(res);
  });
  app.get('/session/:s/element/:e/displayed', (req, res) => {
    const e = byId(req.params.e);
    e ? res.json({ value: e.displayed !== false }) : noSuch(res);
  });
  app.get('/session/:s/element/:e/attribute/:name', (req, res) => {
    const e = byId(req.params.e);
    if (!e) return noSuch(res);
    const attrs: Record<string, string> = {
      'content-desc': e.desc ?? '',
      'resource-id': e.resourceId ?? '',
      class: e.cls,
      enabled: 'true',
      displayed: String(e.displayed !== false),
      password: String(!!e.password),
    };
    res.json({ value: attrs[req.params.name] ?? null });
  });
  app.get('/session/:s/element/:e/rect', (req, res) => {
    const e = byId(req.params.e);
    if (!e) return noSuch(res);
    const [x1, y1, x2, y2] = e.bounds;
    res.json({ value: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  });
  // Screenshot setengah ukuran layar (540×1170): kotak berwarna per elemen.
  app.get('/session/:s/screenshot', (_req, res) => {
    const scale = 0.5;
    const color = (e: El): { color: [number, number, number]; border?: [number, number, number] } =>
      e.cls.endsWith('Button')
        ? { color: [47, 79, 224] }
        : e.cls.endsWith('EditText')
          ? { color: [255, 255, 255], border: [180, 186, 204] }
          : e.id === 'e-title' || e.id === 'e-welcome'
            ? { color: [22, 163, 132] }
            : { color: [255, 255, 255], border: [226, 229, 238] };
    const boxes = elements()
      .filter((e) => e.displayed !== false)
      .map((e) => ({
        x: e.bounds[0] * scale + 8,
        y: e.bounds[1] * scale + 4,
        width: (e.bounds[2] - e.bounds[0]) * scale - 16,
        height: (e.bounds[3] - e.bounds[1]) * scale - 8,
        ...color(e),
      }));
    res.json({ value: renderPng(540, 1170, boxes) });
  });
  app.get('/session/:s/source', (_req, res) => res.json({ value: source() }));
  app.get('/session/:s/window/rect', (_req, res) =>
    res.json({ value: { x: 0, y: 0, width: 1080, height: 2340 } }),
  );
  app.post('/session/:s/actions', (req, res) => {
    const moves = req.body.actions[0].actions.filter((a: { type: string }) => a.type === 'pointerMove');
    state.gestures.push(req.body.actions[0].actions);
    // Jari bergerak ke atas = daftar bergulir ke bawah.
    if (moves.length === 2 && state.screen === 'orders') {
      const dy = moves[1].y - moves[0].y;
      if (dy < 0) state.scroll = Math.min(state.scroll + 10, 30);
      if (dy > 0) state.scroll = Math.max(state.scroll - 10, 0);
    }
    res.json({ value: null });
  });
  app.delete('/session/:s/actions', (_req, res) => res.json({ value: null }));
  app.post('/session/:s/back', (_req, res) => {
    state.screen = 'login';
    res.json({ value: null });
  });
  app.post('/session/:s/execute/sync', (req, res) => {
    state.scripts.push(req.body.script);
    if (req.body.script === 'mobile: isKeyboardShown') return res.json({ value: state.keyboard });
    if (req.body.script === 'mobile: hideKeyboard') state.keyboard = false;
    if (req.body.script === 'mobile: activateApp') state.screen = 'login';
    if (req.body.script === 'mobile: pressKey' && req.body.args?.[0]?.keycode === 4) state.screen = 'login';
    res.json({ value: null });
  });

  const server = http.createServer(app);
  return {
    state,
    server,
    listen: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        ),
      ),
  };
}

/** Mock Appium yang berjalan di proses Testora (dimulai saat pertama dipakai). */
export class MockAppiumServer {
  private started?: Promise<string>;
  readonly mock = mockAppium();

  url(): Promise<string> {
    // unref: Mock Appium tidak menahan proses tetap hidup (server & test bisa selesai).
    this.started ??= this.mock.listen().then((url) => (this.mock.server.unref(), url));
    return this.started;
  }

  close() {
    this.mock.server.close();
  }
}
