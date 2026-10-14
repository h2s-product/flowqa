/**
 * Client Appium minimal di atas protokol W3C WebDriver (HTTP/JSON), tanpa
 * dependensi tambahan. Mendukung server Appium lokal maupun cloud device farm
 * (URL boleh berisi user:key, mis. https://user:key@hub.browserstack.com/wd/hub).
 */

/** Key elemen W3C di respons find element. */
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export class AppiumError extends Error {
  constructor(
    message: string,
    /** Kode error WebDriver, mis. "no such element". */
    readonly code = '',
    readonly status = 0,
  ) {
    super(message);
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class AppiumClient {
  private readonly base: string;
  private readonly authHeader?: string;

  constructor(
    serverUrl: string,
    private readonly timeoutMs = 120_000,
  ) {
    const url = new URL(serverUrl);
    if (url.username || url.password) {
      this.authHeader = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
      url.username = '';
      url.password = '';
    }
    this.base = url.toString().replace(/\/$/, '');
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.authHeader ? { authorization: this.authHeader } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = (error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message;
      throw new AppiumError(`Could not reach the Appium server at ${this.base} (${reason}).`);
    }
    const text = await response.text();
    let json: { value?: unknown } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new AppiumError(
        `The Appium server answered with something that is not JSON (HTTP ${response.status}).`,
        '',
        response.status,
      );
    }
    const value = json.value as { error?: string; message?: string } | undefined;
    if (!response.ok || (value && typeof value === 'object' && 'error' in value && value.error)) {
      const message = (value?.message ?? `HTTP ${response.status}`).split('\n')[0];
      throw new AppiumError(message, value?.error ?? '', response.status);
    }
    return json.value as T;
  }

  status(): Promise<{ ready?: boolean; message?: string; build?: { version?: string } }> {
    return this.request('GET', '/status', undefined, 10_000);
  }

  /** Buat sesi baru dengan capabilities W3C (alwaysMatch). */
  async createSession(capabilities: Record<string, unknown>): Promise<AppiumSession> {
    const value = await this.request<{ sessionId: string; capabilities: Record<string, unknown> }>(
      'POST',
      '/session',
      { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } },
      // Membuat sesi (install app, boot WebDriverAgent) bisa lama.
      Math.max(this.timeoutMs, 300_000),
    );
    return new AppiumSession(this, value.sessionId, value.capabilities ?? {});
  }
}

/** Satu sesi Appium yang sedang terbuka. */
export class AppiumSession {
  constructor(
    private readonly client: AppiumClient,
    readonly id: string,
    readonly capabilities: Record<string, unknown>,
  ) {}

  /** Perintah apa pun di sesi ini (path relatif terhadap /session/:id). */
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.client.request<T>(method, `/session/${this.id}${path}`, body);
  }

  private call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  async findElement(using: string, value: string): Promise<string | null> {
    try {
      const found = await this.call<Record<string, string>>('POST', '/element', { using, value });
      return found[ELEMENT_KEY] ?? found.ELEMENT ?? null;
    } catch (error) {
      if (error instanceof AppiumError && error.code === 'no such element') return null;
      throw error;
    }
  }

  async findElements(using: string, value: string): Promise<string[]> {
    const found = await this.call<Record<string, string>[]>('POST', '/elements', { using, value });
    return found.map((e) => e[ELEMENT_KEY] ?? e.ELEMENT).filter(Boolean);
  }

  click(element: string) {
    return this.call('POST', `/element/${element}/click`, {});
  }
  clear(element: string) {
    return this.call('POST', `/element/${element}/clear`, {});
  }
  sendKeys(element: string, text: string) {
    return this.call('POST', `/element/${element}/value`, { text, value: [...text] });
  }
  text(element: string) {
    return this.call<string>('GET', `/element/${element}/text`);
  }
  displayed(element: string) {
    return this.call<boolean>('GET', `/element/${element}/displayed`);
  }
  rect(element: string) {
    return this.call<Rect>('GET', `/element/${element}/rect`);
  }
  attribute(element: string, name: string) {
    return this.call<string | null>('GET', `/element/${element}/attribute/${encodeURIComponent(name)}`);
  }
  screenshot() {
    return this.call<string>('GET', '/screenshot');
  }
  source() {
    return this.call<string>('GET', '/source');
  }
  windowRect() {
    return this.call<Rect>('GET', '/window/rect');
  }
  back() {
    return this.call('POST', '/back', {});
  }
  /** Perintah khusus Appium, mis. "mobile: hideKeyboard". */
  execute<T = unknown>(script: string, args: Record<string, unknown> = {}) {
    return this.call<T>('POST', '/execute/sync', { script, args: [args] });
  }
  openUrl(url: string) {
    return this.call('POST', '/url', { url });
  }

  /** Gerakan jari (W3C Actions): tap, tekan lama, atau geser. */
  async gesture(points: { x: number; y: number }[], holdMs = 0, moveMs = 400) {
    const [start, ...rest] = points;
    const actions: Record<string, unknown>[] = [
      { type: 'pointerMove', duration: 0, x: Math.round(start.x), y: Math.round(start.y) },
      { type: 'pointerDown', button: 0 },
      ...(holdMs ? [{ type: 'pause', duration: holdMs }] : []),
      ...rest.map((p) => ({ type: 'pointerMove', duration: moveMs, x: Math.round(p.x), y: Math.round(p.y) })),
      { type: 'pointerUp', button: 0 },
    ];
    await this.call('POST', '/actions', {
      actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions }],
    });
    await this.call('DELETE', '/actions').catch(() => {});
  }

  async quit() {
    await this.client.request('DELETE', `/session/${this.id}`).catch(() => {});
  }
}
