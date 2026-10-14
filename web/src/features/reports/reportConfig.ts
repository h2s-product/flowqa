/**
 * Perbedaan halaman Reports antara API Tester (scenario) dan UI Tester (UI test
 * case). Halaman & komponennya sama; hanya label, tautan, dan filter yang berbeda.
 */
import type { FolderKind, ReportKind, UiStepType } from '@flowqa/shared';
import { stepTypeLabel } from '@/features/ui/uiSteps';

export interface ReportConfig {
  folderKind: FolderKind;
  /** Nama item, tunggal & jamak (huruf kecil). */
  one: string;
  many: string;
  printTitle: string;
  /** Kolom "target" run: environment (API) atau browser (UI). */
  targetLabel: string;
  /** UI run tidak terikat environment, jadi filter environment disembunyikan. */
  filterByEnvironment: boolean;
  runPath: (runId: string) => string;
  itemPath: (itemId: string) => string;
  stepTypeLabel: (type: string) => string;
  emptyHint: string;
  csvPrefix: string;
}

const API_STEP_TYPES: Record<string, string> = {
  api: 'API call',
  wait: 'Wait',
  setVariable: 'Set value',
  condition: 'Condition',
};

export const REPORT_CONFIG: Record<ReportKind, ReportConfig> = {
  api: {
    folderKind: 'scenario',
    one: 'scenario',
    many: 'scenarios',
    printTitle: 'Test report',
    targetLabel: 'Environment',
    filterByEnvironment: true,
    runPath: (id) => `/runs/${id}`,
    itemPath: (id) => `/scenarios/${id}`,
    stepTypeLabel: (type) => API_STEP_TYPES[type] ?? type,
    emptyHint: 'Create a scenario, or pick another folder.',
    csvPrefix: 'test-report',
  },
  ui: {
    folderKind: 'ui',
    one: 'UI test',
    many: 'UI tests',
    printTitle: 'UI test report',
    targetLabel: 'Browser',
    filterByEnvironment: false,
    runPath: (id) => `/ui/runs/${id}`,
    itemPath: (id) => `/ui/tests/${id}`,
    stepTypeLabel: (type) => stepTypeLabel(type as UiStepType),
    emptyHint: 'Record a UI test, or pick another folder.',
    csvPrefix: 'ui-test-report',
  },
};

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
