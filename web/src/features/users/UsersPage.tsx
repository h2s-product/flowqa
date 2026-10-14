import { useMemo, useState } from 'react';
import type { UserAccount } from '@flowqa/shared';
import { useDeleteUser, useProjects, useSaveUser, useUsers } from '@/api/queries';
import { Icon } from '@/components/Icon';
import {
  EmptyState,
  ErrorBox,
  IconButton,
  Loading,
  SearchInput,
  Stat,
  StatGrid,
  Toggle,
} from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { UserFormModal } from './UserFormModal';
import { DateTime } from '@/components/DateTime';
import { formatNumber } from '@/lib/format';
import { useConfirm } from '@/context/ConfirmContext';

/** User Administration: daftar akun, peran, status, dan akses project. Khusus admin. */
export function UsersPage() {
  const { user: me } = useAuth();
  const { data: users = [], isLoading, error } = useUsers();
  const { data: projects = [] } = useProjects();
  const save = useSaveUser();
  const confirm = useConfirm();
  const remove = useDeleteUser();
  const toast = useToast();
  const [editing, setEditing] = useState<UserAccount | 'new' | null>(null);
  const [query, setQuery] = useState('');

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const shown = users.filter((u) =>
    `${u.name} ${u.email}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const setActive = (u: UserAccount, active: boolean) =>
    save.mutate(
      { ...u, active },
      {
        onSuccess: () =>
          toast(active ? `${u.name} can sign in again` : `${u.name} has been disabled and signed out`),
      },
    );

  const del = async (u: UserAccount) =>
    (await confirm({
      title: `Delete ${u.name}?`,
      message: `${u.email} can no longer sign in. This cannot be undone — to block access temporarily, turn the account off instead.`,
    })) && remove.mutate(u.id, { onSuccess: () => toast('User deleted') });

  const admins = users.filter((u) => u.role === 'admin' && u.active).length;

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 16, gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          Add team members and choose which projects each one can open.
        </p>
        <div className="grow" />
        <SearchInput value={query} onChange={setQuery} placeholder="Search name or email" width={220} />
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> Add user
        </button>
      </div>

      <StatGrid className="mb-16">
        <Stat label="Users" value={formatNumber(users.length)} />
        <Stat label="Active admins" value={admins} />
        <Stat label="Members" value={users.filter((u) => u.role === 'member').length} />
        <Stat
          label="Disabled"
          value={users.filter((u) => !u.active).length}
          tone={users.some((u) => !u.active) ? 'r' : undefined}
        />
      </StatGrid>

      {shown.length ? (
        <div className="panel tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Project access</th>
                <th>Last sign-in</th>
                <th>Created</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} style={u.active ? undefined : { opacity: 0.6 }}>
                    <td>
                      <b>{u.name}</b>
                      {self && (
                        <span className="chip plain" style={{ marginLeft: 6 }}>
                          You
                        </span>
                      )}
                      <div className="small muted">{u.email}</div>
                    </td>
                    <td>
                      <span className={`status ${u.role === 'admin' ? 'st-running' : 'st-skipped'}`}>
                        {u.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                    </td>
                    <td className="small">
                      {u.role === 'admin' ? (
                        <span className="muted">All projects</span>
                      ) : u.projectIds.length ? (
                        <div className="row wrap" style={{ gap: 4 }}>
                          {u.projectIds.map((id) => (
                            <span key={id} className="chip plain chip-text">
                              {projectName.get(id) ?? 'Deleted project'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--amber)' }}>No projects</span>
                      )}
                    </td>
                    <td className="small">
                      <DateTime value={u.lastLoginAt} relative empty="Never" />
                    </td>
                    <td className="small">
                      <DateTime value={u.createdAt} />
                    </td>
                    <td>
                      <span title={self ? 'You cannot disable your own account' : undefined}>
                        <Toggle
                          checked={u.active}
                          onChange={(v) => !self && setActive(u, v)}
                          label="Active"
                        />
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn sm ghost" onClick={() => setEditing(u)}>
                        Edit
                      </button>
                      <IconButton
                        icon="trash"
                        label={self ? 'You cannot delete your own account' : 'Delete user'}
                        disabled={self}
                        onClick={() => del(u)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <EmptyState title={query ? 'No users match your search' : 'No users yet'} />
        </div>
      )}

      {editing && (
        <UserFormModal user={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
