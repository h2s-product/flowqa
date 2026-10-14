import type { UiPickOptions, UiStep, UiStepType, UiTestCase, UiTestTarget } from '@flowqa/shared';
import { UI_STEP_TYPES } from '@flowqa/shared';
import { Icon, type IconName } from '@/components/Icon';

const ICON: Record<UiStepType, IconName> = {
  navigate: 'globe',
  click: 'cursor',
  fill: 'edit',
  select: 'down',
  check: 'check',
  uncheck: 'minus',
  press: 'skip',
  wait: 'clock',
  assertText: 'eye',
  assertVisible: 'eye',
  assertNotVisible: 'eye',
  assertUrl: 'globe',
  assertEach: 'eye',
  assertSorted: 'eye',
  pickOption: 'check',
  setVariable: 'plus',
  saveText: 'copy',
  uploadFile: 'upload',
  assertColor: 'eye',
  apiScenario: 'code',
  longPress: 'hand',
  swipe: 'swipe',
  scrollTo: 'down',
  back: 'back',
  hideKeyboard: 'keyboard',
  restartApp: 'refresh',
  launchApp: 'play',
  closeApp: 'stop',
  installApk: 'download',
  clearText: 'x',
  pressKey: 'keyboard',
  assertAttribute: 'eye',
  takeScreenshot: 'image',
  pageSource: 'code',
  drawPolygon: 'map',
};

export const DEFAULT_PICK: UiPickOptions = { mode: 'random', text: '', saveAs: '', skip: '' };

/** Target test (test lama tanpa `target` = web). */
export const testTarget = (test?: Pick<UiTestCase, 'target'> | null): UiTestTarget => test?.target ?? 'web';

export const stepTypeInfo = (type: UiStepType) => UI_STEP_TYPES.find((t) => t.id === type)!;
/** Label jenis step; test mobile memakai istilah mobile (Click → Tap). */
export const stepTypeLabel = (type: UiStepType, target: UiTestTarget = 'web') => {
  const info = UI_STEP_TYPES.find((t) => t.id === type);
  return (target === 'mobile' ? info?.mobileLabel : undefined) ?? info?.label ?? type;
};
/** Label isian nilai step untuk target tertentu. */
export const stepValueLabel = (type: UiStepType, target: UiTestTarget = 'web') => {
  const info = stepTypeInfo(type);
  return (target === 'mobile' ? info.mobileValueLabel : undefined) ?? info.valueLabel;
};
/** Jenis step yang tersedia untuk target. */
export const stepTypesFor = (target: UiTestTarget) => UI_STEP_TYPES.filter((t) => t.targets.includes(target));
export const isAssertion = (type: UiStepType) => type.startsWith('assert');

/** Ikon kecil jenis step (aksi berwarna netral, pengecekan berwarna biru). */
export function StepTypeIcon({ type, target = 'web' }: { type: UiStepType; target?: UiTestTarget }) {
  return (
    <span className={`ui-step-icon ${isAssertion(type) ? 'assert' : ''}`} title={stepTypeLabel(type, target)}>
      <Icon name={ICON[type]} size={13} />
    </span>
  );
}

/** Ringkasan nilai step untuk ditampilkan di daftar. */
export function stepValue(step: UiStep): string {
  if (step.type === 'pickOption') {
    const pick = step.pick ?? DEFAULT_PICK;
    const which = pick.mode === 'named' ? `"${pick.text}"` : `${pick.mode} unused option`;
    return `${which}${pick.saveAs ? ` → {{${pick.saveAs}}}` : ''}`;
  }
  if (step.type === 'setVariable') return `{{${step.saveAs ?? ''}}} = ${step.value}`;
  if (step.type === 'saveText')
    return `{{${step.saveAs ?? ''}}} ← text${step.value ? ` (${step.value})` : ''}${step.unique ? ' · not used before' : ''}`;
  if (!step.value) return '';
  if (step.type === 'wait') return `${step.value} ms`;
  if (step.type === 'longPress') return `${step.value} ms`;
  if (step.type === 'assertAttribute') return `${step.attribute ?? ''} = ${step.value}`;
  if (step.type === 'drawPolygon')
    return `${step.value || 4} points${step.saveAs ? ` → {{${step.saveAs}}}` : ''}`;
  return step.value;
}

/**
 * Ubah selector satu pilihan hasil rekaman (mis. role=option[name="Kabupaten Bandung"])
 * menjadi selector untuk SEMUA pilihan di daftar (role=option), dipakai saat step
 * klik diubah menjadi "Pick an option". Selector yang hanya cocok dengan
 * satu elemen (id, test id, teks) dibuang.
 */
export function optionListSelectors(selectors: string[]): string[] {
  const general = selectors
    .map((s) => {
      if (/^role=\w+\[name=/.test(s)) return s.replace(/\[name=.*\]$/, '');
      if (/^(#|text=|\[data-|\[aria-label=)/.test(s)) return '';
      // CSS path: buang :nth-of-type(n) di bagian terakhir supaya cocok dengan semua saudara.
      return s.replace(/:nth-of-type\(\d+\)(?=[^>]*$)/, '');
    })
    .filter(Boolean);
  return [...new Set(general)];
}
