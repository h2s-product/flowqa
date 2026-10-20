/**
 * Reset password akun Testora dari terminal (mis. admin lupa password).
 *
 *   cd server && node --disable-warning=ExperimentalWarning --import tsx scripts/reset-password.ts
 *
 * Email & password baru diminta lewat prompt; ketikan password tidak ditampilkan
 * dan tidak pernah dicetak. Memakai database yang sama dengan server
 * (FLOWQA_DB / data/flowqa.db). Sesi login lama akun tersebut tetap sampai kedaluwarsa.
 */
import { stdin, stdout } from 'node:process';
import { config } from '../src/config';
import { openDatabase } from '../src/db/database';
import { createRepositories } from '../src/repositories';
import { validatePassword } from '../src/domain/user-validation';
import { hashPassword } from '../src/lib/password';
import { nowIso } from '../src/lib/time';

/**
 * Baca input baris demi baris dari terminal. `hidden` = ketikan tidak ditampilkan
 * (password). Satu pembaca untuk semua prompt supaya teks yang di-paste tidak hilang.
 */
let buffer = '';
function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    if (!stdin.isTTY) {
      console.error('Jalankan skrip ini di terminal interaktif.');
      process.exit(1);
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const finish = (line: string) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      resolve(line);
    };
    const take = () => {
      const i = buffer.search(/[\r\n]/);
      if (i < 0) return false;
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1).replace(/^\n/, '');
      finish(line);
      return true;
    };
    function onData(chunk: string) {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buffer.length) {
            buffer = buffer.slice(0, -1);
            if (!hidden) stdout.write('\b \b');
          }
          continue;
        }
        buffer += ch;
        if (!hidden && ch !== '\r' && ch !== '\n') stdout.write(ch);
      }
      take();
    }
    if (!take()) stdin.on('data', onData);
  });
}

const repos = createRepositories(openDatabase(config.dbFile));
console.log(`Database: ${config.dbFile}`);
console.log('Akun:', repos.users.list().map((u) => `${u.email} (${u.role})`).join(', '));
const email = (await ask('Email akun yang akan di-reset: ')).trim().toLowerCase();

const user = repos.users.findByEmail(email);
if (!user) {
  console.error(`Akun ${email} tidak ditemukan.`);
  process.exit(1);
}
const password = await ask('Password baru: ', true);
const again = await ask('Ulangi password baru: ', true);
if (password !== again) {
  console.error('Password tidak sama. Tidak ada yang diubah.');
  process.exit(1);
}
try {
  validatePassword(password);
} catch (error) {
  console.error(`${(error as Error).message} Tidak ada yang diubah.`);
  process.exit(1);
}
repos.users.save({ ...user, passwordHash: await hashPassword(password), active: true, updatedAt: nowIso() });
console.log(`Password ${email} berhasil diganti. Silakan login di Testora dengan password baru.`);
process.exit(0);
