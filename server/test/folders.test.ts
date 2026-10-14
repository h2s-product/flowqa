import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { ApiDefinition } from '@flowqa/shared';
import { openDatabase } from '../src/db/database';
import { createRepositories } from '../src/repositories';
import {
  FolderService,
  descendantIds,
  folderDepth,
  migrateLegacyApiGroups,
} from '../src/services/folder-service';
import { normalizeApi, normalizeProject, normalizeScenario } from '../src/domain/normalizers';

describe('FolderService', () => {
  let repos: ReturnType<typeof createRepositories>;
  let folders: FolderService<ApiDefinition>;
  let projectId: string;
  const api = (name: string, folderId: string | null) =>
    repos.apis.save(normalizeApi({ name, path: `/${name}`, folderId }, projectId));

  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
    folders = new FolderService(repos.apiFolders, repos.apis, 'API');
    projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
  });

  it('creates nested folders and rejects duplicate sibling names', () => {
    const orders = folders.create(projectId, { name: 'Orders' });
    const refunds = folders.create(projectId, { name: 'Refunds', parentId: orders.id });
    assert.equal(refunds.parentId, orders.id);
    assert.equal(folderDepth(folders.list(projectId), refunds.id), 2);
    assert.throws(() => folders.create(projectId, { name: 'orders' }), /already exists/);
    assert.ok(
      folders.create(projectId, { name: 'Orders', parentId: refunds.id }),
      'same name elsewhere is fine',
    );
    assert.throws(() => folders.create(projectId, { name: '  ' }), /name/);
  });

  it('limits nesting depth', () => {
    let parentId: string | null = null;
    for (let i = 1; i <= 5; i++) parentId = folders.create(projectId, { name: `L${i}`, parentId }).id;
    assert.throws(() => folders.create(projectId, { name: 'L6', parentId }), /at most 5 levels/);
  });

  it('prevents moving a folder into its own subtree', () => {
    const a = folders.create(projectId, { name: 'A' });
    const b = folders.create(projectId, { name: 'B', parentId: a.id });
    const c = folders.create(projectId, { name: 'C', parentId: b.id });
    assert.throws(() => folders.update(a, { parentId: c.id }), /into itself/);
    assert.throws(() => folders.update(a, { parentId: a.id }), /into itself/);
    assert.deepEqual([...descendantIds(folders.list(projectId), a.id)].sort(), [b.id, c.id].sort());
    const moved = folders.update(c, { parentId: null, name: 'C top' });
    assert.equal(moved.parentId, null);
    assert.equal(moved.name, 'C top');
  });

  it('deleting a folder moves its APIs and subfolders up one level', () => {
    const parent = folders.create(projectId, { name: 'Parent' });
    const doomed = folders.create(projectId, { name: 'Doomed', parentId: parent.id });
    const child = folders.create(projectId, { name: 'Child', parentId: doomed.id });
    folders.create(projectId, { name: 'Child', parentId: parent.id });
    const inside = api('inside', doomed.id);
    const result = folders.delete(doomed);
    assert.deepEqual(result, { movedItems: 1, movedFolders: 1 });
    assert.equal(repos.apis.get(inside.id)?.folderId, parent.id);
    const renamed = repos.apiFolders.get(child.id)!;
    assert.equal(renamed.parentId, parent.id);
    assert.equal(renamed.name, 'Child (2)', 'avoids a duplicate name in the parent');
    assert.equal(repos.apiFolders.get(doomed.id), undefined);
  });

  it('moves APIs in bulk and validates the target folder', () => {
    const target = folders.create(projectId, { name: 'Target' });
    const a = api('a', null);
    const b = api('b', null);
    assert.equal(folders.moveItems(projectId, [a.id, b.id], target.id), 2);
    assert.equal(repos.apis.get(b.id)?.folderId, target.id);
    assert.equal(folders.moveItems(projectId, [a.id], null), 1);
    assert.throws(() => folders.moveItems(projectId, [a.id], 'fld_missing'), /does not exist/);
    const other = repos.projects.save(normalizeProject({ name: 'Other' })).id;
    const foreign = new FolderService(repos.apiFolders, repos.apis, 'API').create(other, { name: 'Foreign' });
    assert.throws(() => folders.moveItems(projectId, [a.id], foreign.id), /does not exist/);
  });

  it('migrates legacy "group" values into folders once', () => {
    const legacy = { ...api('old', null), group: 'Payments' } as ApiDefinition & { group?: string };
    delete (legacy as Partial<ApiDefinition>).folderId;
    repos.apis.save(legacy);
    assert.equal(migrateLegacyApiGroups(repos.apis, folders), 1);
    const migrated = repos.apis.get(legacy.id) as ApiDefinition & { group?: string };
    assert.equal(migrated.group, undefined);
    assert.equal(repos.apiFolders.get(migrated.folderId!)?.name, 'Payments');
    assert.equal(migrateLegacyApiGroups(repos.apis, folders), 0, 'idempotent');
  });

  it('keeps scenario folders separate from API folders', () => {
    const scenarioFolders = new FolderService(repos.scenarioFolders, repos.scenarios, 'scenario');
    const smoke = scenarioFolders.create(projectId, { name: 'Smoke' });
    folders.create(projectId, { name: 'Smoke' });
    const scenario = repos.scenarios.save(normalizeScenario({ name: 'Login check' }, projectId));
    assert.equal(scenario.folderId, null);
    assert.equal(scenarioFolders.moveItems(projectId, [scenario.id], smoke.id), 1);
    assert.equal(repos.scenarios.get(scenario.id)?.folderId, smoke.id);
    assert.throws(
      () => folders.assertFolder(projectId, smoke.id),
      /does not exist/,
      'API tree cannot use it',
    );
    assert.deepEqual(scenarioFolders.delete(smoke), { movedItems: 1, movedFolders: 0 });
    assert.equal(repos.scenarios.get(scenario.id)?.folderId, null);
    assert.throws(() => scenarioFolders.moveItems(projectId, ['scn_missing'], null), /scenario not found/);
  });
});
