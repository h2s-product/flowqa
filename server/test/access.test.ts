import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Run } from '@flowqa/shared';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app';
import { createAppContext } from '../src/app-context';
import { openDatabase } from '../src/db/database';
import { normalizeApi, normalizeProject } from '../src/domain/normalizers';
import type { HttpClient } from '../src/engine/http-client';
import { createRepositories } from '../src/repositories';

const noHttp: HttpClient = { send: () => Promise.reject(new Error('no network in tests')) };

describe('project access over HTTP', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  const ctx = createAppContext(repos, noHttp);
  const { auth } = ctx;
  const app = createApp(ctx);
  const projectA = repos.projects.save(normalizeProject({ name: 'Project A' }));
  const projectB = repos.projects.save(normalizeProject({ name: 'Project B' }));
  const apiB = repos.apis.save(normalizeApi({ name: 'B only', path: '/b' }, projectB.id));
  let base = '';
  let server: ReturnType<typeof app.listen>;
  let adminCookie = '';
  let memberCookie = '';
  let memberId = '';
  let adminId = '';

  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        cookie,
        'X-Requested-With': 'test',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  };
  const login = async (email: string, password: string) => {
    const res = await call('', 'POST', '/auth/login', { email, password });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.headers.get('set-cookie')!.split(';')[0];
  };

  before(async () => {
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adminId = (await auth.createUser({ name: 'Admin', email: 'admin@x.co', password: 'admin-pass' })).id;
    adminCookie = await login('admin@x.co', 'admin-pass');
    const created = await call(adminCookie, 'POST', '/users', {
      name: 'Member',
      email: 'member@x.co',
      password: 'member-pass',
      role: 'member',
      projectIds: [projectA.id],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.projectIds, [projectA.id]);
    assert.equal(created.body.passwordHash, undefined);
    memberId = created.body.id;
    memberCookie = await login('member@x.co', 'member-pass');
  });
  after(() => server.close());

  it('lists only assigned projects for a member', async () => {
    const res = await call(memberCookie, 'GET', '/projects');
    assert.deepEqual(
      res.body.map((p: { name: string }) => p.name),
      ['Project A'],
    );
    assert.equal((await call(adminCookie, 'GET', '/projects')).body.length, 2);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectA.id}/dashboard`)).status, 200);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectB.id}/dashboard`)).status, 404);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectA.id}/report`)).status, 200);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectB.id}/report`)).status, 404);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectA.id}/report?from=nope`)).status, 400);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectA.id}/ui-report`)).status, 200);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectB.id}/ui-report`)).status, 404);
  });

  it('hides other projects and their resources from a member', async () => {
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectB.id}`)).status, 404);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectB.id}/apis`)).status, 404);
    assert.equal((await call(memberCookie, 'PUT', `/apis/${apiB.id}`, { name: 'hacked' })).status, 404);
    assert.equal((await call(memberCookie, 'DELETE', `/apis/${apiB.id}`)).status, 404);
    assert.equal(repos.apis.get(apiB.id)?.name, 'B only');
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectA.id}/apis`)).status, 200);
  });

  it('keeps user administration admin-only', async () => {
    assert.equal((await call(memberCookie, 'GET', '/users')).status, 403);
    assert.equal((await call(memberCookie, 'POST', '/users', { name: 'x' })).status, 403);
    assert.equal((await call(memberCookie, 'DELETE', `/projects/${projectA.id}`)).status, 403);
  });

  it('gives a member access to projects they create', async () => {
    const res = await call(memberCookie, 'POST', '/projects', { name: 'Member project' });
    assert.equal(res.status, 201);
    assert.equal((await call(memberCookie, 'GET', `/projects/${res.body.id}`)).status, 200);
  });

  it('protects the last admin and the current user', async () => {
    const demote = await call(adminCookie, 'PUT', `/users/${adminId}`, { role: 'member' });
    assert.equal(demote.status, 400);
    assert.equal((await call(adminCookie, 'DELETE', `/users/${adminId}`)).status, 400);
  });

  it('updates project access and signs out disabled users', async () => {
    const granted = await call(adminCookie, 'PUT', `/users/${memberId}`, {
      projectIds: [projectA.id, projectB.id],
    });
    assert.equal(granted.status, 200);
    assert.equal((await call(memberCookie, 'GET', `/projects/${projectB.id}/apis`)).status, 200);

    const disabled = await call(adminCookie, 'PUT', `/users/${memberId}`, { active: false });
    assert.equal(disabled.status, 200);
    assert.equal((await call(memberCookie, 'GET', '/projects')).status, 401);
    const relogin = await call('', 'POST', '/auth/login', { email: 'member@x.co', password: 'member-pass' });
    assert.equal(relogin.status, 403);
  });

  it('lets users change their own password', async () => {
    const wrong = await call(adminCookie, 'POST', '/account/password', {
      currentPassword: 'nope',
      newPassword: 'new-admin-pass',
    });
    assert.equal(wrong.status, 400);
    const ok = await call(adminCookie, 'POST', '/account/password', {
      currentPassword: 'admin-pass',
      newPassword: 'new-admin-pass',
    });
    assert.equal(ok.status, 204);
    assert.equal((await call(adminCookie, 'GET', '/projects')).status, 200, 'current session is kept');
    await login('admin@x.co', 'new-admin-pass');
  });

  it('deletes test runs (one or many), keeps running ones, and stays inside the project', async () => {
    // Member baru (member lama sudah diubah oleh test sebelumnya).
    await call(adminCookie, 'POST', '/users', {
      name: 'Runner',
      email: 'runner@x.co',
      password: 'runner-pass',
      role: 'member',
      projectIds: [projectA.id],
    });
    const cookie = await login('runner@x.co', 'runner-pass');
    const now = new Date().toISOString();
    let n = 0;
    const apiRun = (projectId: string, status: Run['status'] = 'passed') =>
      repos.runs.save({
        id: `run_del${++n}`,
        projectId,
        scenarioId: 'scn_x',
        scenarioName: 'X',
        environmentId: 'env_x',
        environmentName: 'Dev',
        status,
        trigger: 'manual',
        mode: 'Full run',
        startedAt: now,
        finishedAt: now,
        durationMs: 1,
        steps: [],
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        variables: {},
        createdAt: now,
        updatedAt: now,
      });

    // Satu run
    const single = apiRun(projectA.id);
    assert.equal((await call(cookie, 'DELETE', `/runs/${single.id}`)).status, 204);
    assert.equal(repos.runs.get(single.id), undefined);
    const running = apiRun(projectA.id, 'running');
    assert.equal((await call(cookie, 'DELETE', `/runs/${running.id}`)).status, 409);
    const otherProject = apiRun(projectB.id);
    assert.equal((await call(cookie, 'DELETE', `/runs/${otherProject.id}`)).status, 404);

    // Banyak run: run project lain & yang masih berjalan tidak ikut terhapus
    const a1 = apiRun(projectA.id);
    const a2 = apiRun(projectA.id);
    const bulk = await call(cookie, 'POST', `/projects/${projectA.id}/runs/delete`, {
      ids: [a1.id, a2.id, running.id, otherProject.id],
    });
    assert.deepEqual(bulk.body, { deleted: 2, running: 1 });
    assert.ok(repos.runs.get(running.id) && repos.runs.get(otherProject.id));
    const foreign = await call(cookie, 'POST', `/projects/${projectB.id}/runs/delete`, {
      ids: [otherProject.id],
    });
    assert.equal(foreign.status, 404);
    assert.equal(
      (await call(cookie, 'POST', `/projects/${projectA.id}/runs/delete`, { ids: [] })).status,
      400,
    );
    assert.equal(
      (await call(cookie, 'POST', `/projects/${projectA.id}/ui-runs/delete`, { ids: ['uir_none'] })).status,
      200,
    );
  });

  it('validates bulk UI runs and keeps them inside the project', async () => {
    await call(adminCookie, 'POST', '/users', {
      name: 'Bulk',
      email: 'bulk@x.co',
      password: 'bulk-pass-1',
      role: 'member',
      projectIds: [projectA.id],
    });
    const cookie = await login('bulk@x.co', 'bulk-pass-1');
    const batch = (projectId: string, body: unknown) =>
      call(cookie, 'POST', `/projects/${projectId}/ui-tests/run-batch`, body);
    assert.equal((await batch(projectB.id, { ids: ['uit_x'] })).status, 404);
    assert.equal((await batch(projectA.id, { ids: [] })).status, 400);
    const none = await batch(projectA.id, { ids: ['uit_missing'] });
    assert.equal(none.status, 400);
    assert.match(none.body.error, /None of the selected UI tests/);
  });
});
