/**
 * Mengingat URL awal & login rekaman sebagai variabel environment, supaya
 * rekaman berikutnya cukup memilih {{WEB_URL}} / {{WEB_USER}} / {{WEB_PASSWORD}}
 * dan test hasil rekaman tetap jalan walau URL atau password berubah.
 */
import type { EnvVariable, Environment, RecordingLogin } from '@flowqa/shared';
import { RECORDING_VARIABLES } from '@flowqa/shared';

/** Bagian yang boleh disimpan / diganti (true = simpan, menimpa nilai lama bila ada). */
export interface RememberChoice {
  url?: boolean;
  user?: boolean;
  password?: boolean;
}

const isReference = (value: string) => value.includes('{{');
const reference = (key: string) => `{{${key}}}`;

/**
 * Simpan nilai yang diketik langsung ke variabel environment, lalu kembalikan
 * URL & login yang sudah diganti dengan {{VARIABEL}}. Nilai yang sudah berupa
 * variabel, atau yang tidak dipilih untuk disimpan, tidak diubah.
 */
export function rememberRecordingInputs(
  environment: Environment,
  input: { startUrl: string; login: RecordingLogin | null },
  choice: RememberChoice,
): { variables: EnvVariable[]; startUrl: string; login: RecordingLogin | null; saved: string[] } {
  const variables = [...environment.variables];
  const saved: string[] = [];
  const store = (key: string, value: string, secret: boolean) => {
    const entry = { key, value, secret };
    const index = variables.findIndex((v) => v.key === key);
    if (index >= 0) variables[index] = entry;
    else variables.push(entry);
    saved.push(key);
    return reference(key);
  };

  const startUrl =
    choice.url && input.startUrl && !isReference(input.startUrl)
      ? store(RECORDING_VARIABLES.url, input.startUrl, false)
      : input.startUrl;
  let login = input.login;
  if (login) {
    login = { ...login };
    if (choice.user && login.username && !isReference(login.username))
      login.username = store(RECORDING_VARIABLES.user, login.username, false);
    if (choice.password && login.password && !isReference(login.password))
      login.password = store(RECORDING_VARIABLES.password, login.password, true);
  }
  return { variables, startUrl, login, saved };
}
