import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../src/db/database';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { UserRepository } from '../src/repositories/user-repository';
import { AuthService } from '../src/services/auth-service';

const DAY = 86_400_000;

function setup() {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const users = new UserRepository(openDatabase(':memory:'));
  const auth = new AuthService(users, 7, () => now);
  return { auth, users, advance: (ms: number) => (now += ms) };
}

const admin = { name: 'Rina', email: 'Rina@Example.com', password: 'correct horse' };

describe('password hashing', () => {
  it('verifies only the original password', async () => {
    const hash = await hashPassword('s3cret-pass');
    assert.match(hash, /^scrypt\$/);
    assert.ok(!hash.includes('s3cret-pass'));
    assert.equal(await verifyPassword('s3cret-pass', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('s3cret-pass', 'garbage'), false);
  });
});

describe('AuthService', () => {
  it('creates the first account once', async () => {
    const { auth } = setup();
    assert.equal(auth.setupRequired, true);
    const user = await auth.setup(admin);
    assert.equal(user.email, 'rina@example.com');
    assert.ok(!('passwordHash' in user));
    assert.equal(auth.setupRequired, false);
    await assert.rejects(auth.setup({ ...admin, email: 'other@example.com' }), /already exists/);
  });

  it('validates new accounts', async () => {
    const { auth } = setup();
    await assert.rejects(auth.setup({ ...admin, password: 'short' }), /at least 8/);
    await assert.rejects(auth.setup({ ...admin, email: 'nope' }), /valid email/);
    await assert.rejects(auth.setup({ ...admin, name: ' ' }), /name/);
  });

  it('logs in, authenticates the session and logs out', async () => {
    const { auth, users } = setup();
    await auth.setup(admin);
    const session = await auth.login('RINA@example.com ', admin.password, 'ip');
    assert.equal(session.user.name, 'Rina');
    assert.equal(auth.authenticate(session.token)?.email, 'rina@example.com');
    assert.equal(users.findSession(session.token), undefined, 'raw token must not be stored');
    auth.logout(session.token);
    assert.equal(auth.authenticate(session.token), undefined);
  });

  it('rejects wrong credentials with the same message', async () => {
    const { auth } = setup();
    await auth.setup(admin);
    await assert.rejects(auth.login(admin.email, 'wrong password', 'ip'), /incorrect/);
    await assert.rejects(auth.login('unknown@example.com', admin.password, 'ip'), /incorrect/);
    assert.equal(auth.authenticate('made-up-token'), undefined);
    assert.equal(auth.authenticate(undefined), undefined);
  });

  it('expires sessions and extends active ones', async () => {
    const { auth, advance } = setup();
    await auth.setup(admin);
    const { token } = await auth.login(admin.email, admin.password, 'ip');
    advance(5 * DAY);
    assert.ok(auth.authenticate(token), 'still valid, and extended by 7 days');
    advance(6 * DAY);
    assert.ok(auth.authenticate(token), 'valid thanks to the extension');
    advance(8 * DAY);
    assert.equal(auth.authenticate(token), undefined);
  });

  it('locks out after repeated failures', async () => {
    const { auth, advance } = setup();
    await auth.setup(admin);
    for (let i = 0; i < 10; i++) await assert.rejects(auth.login(admin.email, 'bad', 'ip'));
    await assert.rejects(auth.login(admin.email, admin.password, 'ip'), /Too many failed attempts/);
    assert.ok(await auth.login(admin.email, admin.password, 'other-ip'), 'other clients are not blocked');
    advance(16 * 60_000);
    assert.ok(await auth.login(admin.email, admin.password, 'ip'));
  });
});
