/**
 * Selector Android → strategi WebDriver/Appium (UiAutomator2). Format:
 *   ~add_land                     Accessibility ID (content-desc)
 *   id=com.app:id/name            Resource ID
 *   android=new UiSelector()…     Android UIAutomator (alias: uiautomator=)
 *   //android.widget.Button[…]    XPath (alias: xpath=)
 *   class=android.widget.EditText Class name
 *   text=Simpan / text*=Sim       Text persis / mengandung (lewat UiSelector)
 * Selector tanpa awalan dianggap Accessibility ID.
 */
import type { MobilePlatform, MobileSelectorType } from '@flowqa/shared';

export interface Locator {
  using: string;
  value: string;
}

const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Jenis selector & nilainya (untuk tampilan dan ekspor rekaman). */
export function describeSelector(selector: string): { selectorType: MobileSelectorType; selector: string } {
  const s = selector.trim();
  if (s.startsWith('~')) return { selectorType: 'accessibilityId', selector: s.slice(1) };
  if (s.startsWith('//') || s.startsWith('(//')) return { selectorType: 'xpath', selector: s };
  const eq = s.indexOf('=');
  const prefix = eq > 0 ? s.slice(0, eq) : '';
  const rest = eq > 0 ? s.slice(eq + 1) : s;
  switch (prefix) {
    case 'id':
      return { selectorType: 'resourceId', selector: rest };
    case 'xpath':
      return { selectorType: 'xpath', selector: rest };
    case 'android':
    case 'uiautomator':
      return { selectorType: 'uiautomator', selector: rest };
    case 'class':
      return { selectorType: 'className', selector: rest };
    case 'text':
    case 'text*':
      return { selectorType: 'text', selector: rest };
    default:
      return { selectorType: 'accessibilityId', selector: s };
  }
}

export function toLocator(selector: string, _platform: MobilePlatform = 'android'): Locator {
  const s = selector.trim();
  if (s.startsWith('~')) return { using: 'accessibility id', value: s.slice(1) };
  if (s.startsWith('//') || s.startsWith('(//')) return { using: 'xpath', value: s };
  const eq = s.indexOf('=');
  const prefix = eq > 0 ? s.slice(0, eq) : '';
  const rest = eq > 0 ? s.slice(eq + 1) : s;
  switch (prefix) {
    case 'id':
      // "pkg:id/nama" = id Android biasa. Tanpa ":" bisa berupa testTag Compose ("home_header")
      // yang tidak berawalan package, atau singkatan "nama" untuk "pkg:id/nama": cocokkan keduanya.
      if (rest.includes(':')) return { using: 'id', value: rest };
      return {
        using: '-android uiautomator',
        value: `new UiSelector().resourceIdMatches(${quote(`^(.+:id/)?${rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)})`,
      };
    case 'xpath':
      return { using: 'xpath', value: rest };
    case 'android':
    case 'uiautomator':
      return { using: '-android uiautomator', value: rest };
    case 'class':
      return { using: 'class name', value: rest };
    case 'text':
      return { using: '-android uiautomator', value: `new UiSelector().text(${quote(rest)})` };
    case 'text*':
      return { using: '-android uiautomator', value: `new UiSelector().textContains(${quote(rest)})` };
    default:
      return { using: 'accessibility id', value: s };
  }
}
