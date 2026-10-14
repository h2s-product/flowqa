/**
 * Mengubah page source UiAutomator2 (XML) menjadi daftar elemen untuk Mobile
 * Inspector: posisi di screenshot, semua atribut Android, dan selector yang
 * disarankan. Urutan rekomendasi: Accessibility ID → Resource ID → UiSelector
 * (teks) → Class name → XPath atribut → XPath absolut (pilihan terakhir).
 * Selector yang unik di layar selalu didahulukan.
 */
import type { MobileElement } from '@flowqa/shared';

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Posisi di pohon, mis. "0.3.1". */
  path: string;
  /** XPath absolut dengan indeks per nama tag, cadangan terakhir. */
  xpath: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#')
      return String.fromCodePoint(
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
      );
    return ENTITIES[code] ?? whole;
  });

/** Parser XML kecil: cukup untuk page source Appium (tanpa CDATA/teks campuran). */
export function parseXml(xml: string): XmlNode | null {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], path: '', xpath: '' };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attrRe = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of xml.matchAll(tagRe)) {
    const [, closing, tag, rawAttrs, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const parent = stack[stack.length - 1];
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(attrRe)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    const sameTag = parent.children.filter((c) => c.tag === tag).length + 1;
    const node: XmlNode = {
      tag,
      attrs,
      children: [],
      path: parent.path ? `${parent.path}.${parent.children.length}` : String(parent.children.length),
      // Root tanpa indeks (mis. /hierarchy), seperti XPath di Appium Inspector.
      xpath: parent.tag === '#root' ? `/${tag}` : `${parent.xpath}/${tag}[${sameTag}]`,
    };
    parent.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children[0] ?? null;
}

const quote = (text: string) => (text.includes('"') ? `'${text}'` : `"${text}"`);
const shortType = (cls: string) => cls.replace(/^.*\./, '');
const uiQuote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Atribut Android yang ditampilkan di Inspector (urut). */
export const ANDROID_ATTRIBUTES = [
  'text',
  'content-desc',
  'resource-id',
  'class',
  'package',
  'bounds',
  'enabled',
  'clickable',
  'focusable',
  'focused',
  'selected',
  'checked',
  'checkable',
  'scrollable',
  'long-clickable',
  'password',
  'displayed',
  'hint',
] as const;

interface Raw {
  node: XmlNode;
  cls: string;
  text: string;
  desc: string;
  resourceId: string;
  bounds: { x: number; y: number; width: number; height: number };
}

function readNode(node: XmlNode): Raw {
  const a = node.attrs;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a.bounds ?? '');
  if (m) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    bounds = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  return {
    node,
    cls: a.class ?? node.tag,
    text: a.text ?? '',
    desc: a['content-desc'] ?? '',
    resourceId: a['resource-id'] ?? '',
    bounds,
  };
}

function describe(raw: Raw): string {
  const kind = shortType(raw.cls);
  const name = raw.desc || raw.text || raw.node.attrs.hint || raw.resourceId.replace(/^.*:id\//, '');
  return name ? `${kind} "${name.slice(0, 60)}"` : kind;
}

/** Elemen yang layak dipilih di Inspector. `scale` = piksel screenshot per koordinat Appium (Android: 1). */
export function parsePageSource(xml: string, _platform: 'android' = 'android', scale = 1): MobileElement[] {
  const root = parseXml(xml);
  if (!root) return [];
  const all: Raw[] = [];
  const walk = (node: XmlNode) => {
    // Node pembungkus (hierarchy) tidak punya posisi sendiri.
    if (node.tag !== 'hierarchy') all.push(readNode(node));
    node.children.forEach(walk);
  };
  walk(root);

  const count = (pick: (r: Raw) => string, value: string) => all.filter((r) => pick(r) === value).length;
  const elements: MobileElement[] = [];
  for (const raw of all) {
    const a = raw.node.attrs;
    const visible = a.displayed !== 'false';
    if (!visible || raw.bounds.width <= 0 || raw.bounds.height <= 0) continue;
    const clickable = a.clickable === 'true' || a.checkable === 'true' || a['long-clickable'] === 'true';
    const interesting =
      clickable ||
      raw.text ||
      raw.desc ||
      raw.resourceId ||
      a.scrollable === 'true' ||
      !raw.node.children.length;
    if (!interesting) continue;

    const unique: string[] = [];
    const repeated: string[] = [];
    const add = (selector: string, matches: number) => (matches === 1 ? unique : repeated).push(selector);
    if (raw.desc)
      add(
        `~${raw.desc}`,
        count((r) => r.desc, raw.desc),
      );
    if (raw.resourceId)
      add(
        `id=${raw.resourceId}`,
        count((r) => r.resourceId, raw.resourceId),
      );
    // Teks kolom isian = hint/nilai yang diketik (berubah), jadi tidak dipakai sebagai selector.
    const input = /EditText|AutoCompleteTextView/.test(raw.cls);
    if (!input && raw.text && raw.text.length <= 80)
      add(
        `text=${raw.text}`,
        count((r) => r.text, raw.text),
      );
    // UiSelector gabungan resource-id + teks: unik walau resource-id dipakai berulang (item daftar).
    if (!input && raw.resourceId && raw.text && raw.text.length <= 80)
      add(
        `android=new UiSelector().resourceId(${uiQuote(raw.resourceId)}).text(${uiQuote(raw.text)})`,
        all.filter((r) => r.resourceId === raw.resourceId && r.text === raw.text).length,
      );
    if (count((r) => r.cls, raw.cls) === 1) unique.push(`class=${raw.cls}`);
    // Tidak ada yang unik → resource-id + urutan (instance) tetap lebih stabil dari XPath absolut.
    if (!unique.length && raw.resourceId) {
      const instance = all.filter((r) => r.resourceId === raw.resourceId).indexOf(raw);
      unique.push(`android=new UiSelector().resourceId(${uiQuote(raw.resourceId)}).instance(${instance})`);
    }
    // XPath berdasarkan atribut, lalu XPath absolut sebagai cadangan terakhir.
    const attr = raw.resourceId ? 'resource-id' : raw.desc ? 'content-desc' : raw.text ? 'text' : '';
    if (attr) repeated.push(`//${raw.cls}[@${attr}=${quote(a[attr])}]`);
    repeated.push(raw.node.xpath);

    const attributes: Record<string, string> = {};
    for (const key of ANDROID_ATTRIBUTES) if (a[key] !== undefined) attributes[key] = a[key];
    const round = (n: number) => Math.round(n * scale);
    elements.push({
      path: raw.node.path,
      type: shortType(raw.cls),
      text: raw.text,
      accessibilityId: raw.desc,
      resourceId: raw.resourceId,
      label: raw.desc || raw.text || a.hint || '',
      enabled: a.enabled !== 'false',
      secure: a.password === 'true',
      bounds: {
        x: round(raw.bounds.x),
        y: round(raw.bounds.y),
        width: round(raw.bounds.width),
        height: round(raw.bounds.height),
      },
      attributes,
      selectors: [...new Set([...unique, ...repeated])],
      description: describe(raw),
    });
  }
  return elements.slice(0, 1_500);
}
