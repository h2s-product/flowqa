import type { ApiDefinition, ApiStep, Environment, Scenario, StepResult } from '@flowqa/shared';

/** Props bersama untuk semua tab konfigurasi API step. */
export interface ApiStepTabProps {
  step: ApiStep;
  update: (patch: Partial<ApiStep>) => void;
  api?: ApiDefinition;
  apis: ApiDefinition[];
  scenario: Scenario;
  index: number;
  environment?: Environment;
  /** Hasil step ini pada run terakhir (jika ada). */
  result?: StepResult;
}

/** Data response untuk pemilih field: dari run terakhir, atau contoh response API. */
export function responseSample(props: Pick<ApiStepTabProps, 'result' | 'api'>): {
  data: unknown;
  fromRun: boolean;
} {
  const body = props.result?.response?.body;
  if (body && typeof body === 'object') return { data: body, fromRun: true };
  return { data: props.api?.exampleResponse ?? {}, fromRun: false };
}
