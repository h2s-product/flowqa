/** Environment & resolver {{variabel}} untuk UI Tester (recorder dan runner). */
import type { Environment } from '@flowqa/shared';
import { VariableContext } from '../variable-context';

/** Environment kosong untuk test yang tidak memakai variabel environment. */
const NO_ENVIRONMENT: Environment = {
  id: '',
  projectId: '',
  name: 'None',
  baseUrl: '',
  timeoutMs: 30_000,
  verifySsl: true,
  proxy: '',
  variables: [],
  headers: [],
  createdAt: '',
  updatedAt: '',
};

export const noEnvironment = (): Environment => NO_ENVIRONMENT;

/**
 * Variabel untuk satu run/rekaman UI: dipanggil sebagai fungsi untuk
 * menerjemahkan {{variabel}}, dan `set` untuk menyimpan nilai baru selama run
 * (mis. pilihan dari step "pickOption").
 */
export type UiVariables = ((text: string) => string) & {
  set(name: string, value: string): void;
  /** Variabel yang diisi selama run (Set a value, Pick an option, hasil API scenario). */
  snapshot(): Record<string, unknown>;
};

/** Resolver {{variabel}}; melempar error yang jelas bila ada variabel yang tidak dikenal. */
export function variableResolver(environment: Environment): UiVariables {
  const context = new VariableContext(environment);
  const resolve = (text: string) => {
    const missing: string[] = [];
    const value = context.resolve(text, missing);
    if (missing.length)
      throw new Error(
        `Unknown variable ${missing.map((m) => `{{${m}}}`).join(', ')}. Add it to the environment "${environment.name}", or save it with an earlier "Set a value" / "Pick an option" step.`,
      );
    return value;
  };
  return Object.assign(resolve, {
    set: (name: string, value: string) => context.set(name, value),
    snapshot: () => context.snapshot(),
  });
}
