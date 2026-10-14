import { useState } from 'react';
import type { SaveUserRequest, UserAccount, UserRole } from '@flowqa/shared';
import { PASSWORD_MIN_LENGTH } from '@flowqa/shared';
import { useProjects, useSaveUser } from '@/api/queries';
import { Modal } from '@/components/Modal';
import { Field, Segmented, Toggle } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tambah/ubah user: profil, peran, status aktif, password, dan project yang boleh diakses. */
export function UserFormModal({ user, onClose }: { user?: UserAccount; onClose: () => void }) {
  const { user: me } = useAuth();
  const { data: projects = [] } = useProjects();
  const save = useSaveUser();
  const toast = useToast();
  const isSelf = user?.id === me?.id;
  const [draft, setDraft] = useState<SaveUserRequest>({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? 'member',
    active: user?.active ?? true,
    projectIds: user?.projectIds ?? [],
    password: '',
  });
  const set = (patch: Partial<SaveUserRequest>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleProject = (id: string) =>
    set({
      projectIds: draft.projectIds.includes(id)
        ? draft.projectIds.filter((p) => p !== id)
        : [...draft.projectIds, id],
    });

  const password = draft.password ?? '';
  const problems = [
    !draft.name.trim() && 'Enter a name.',
    !EMAIL_RE.test(draft.email.trim()) && 'Enter a valid email address.',
    !user &&
      password.length < PASSWORD_MIN_LENGTH &&
      `Set a password of at least ${PASSWORD_MIN_LENGTH} characters.`,
    user &&
      password &&
      password.length < PASSWORD_MIN_LENGTH &&
      `New password needs ${PASSWORD_MIN_LENGTH}+ characters.`,
  ].filter(Boolean) as string[];

  const submit = () =>
    save.mutate(
      { ...draft, id: user?.id, password: password || undefined },
      {
        onSuccess: () => (toast(user ? 'User updated' : 'User added'), onClose()),
      },
    );

  return (
    <Modal
      wide
      title={user ? `Edit ${user.name}` : 'Add user'}
      subtitle="Members can only open the projects you tick below. Admins can open every project and manage users."
      onClose={onClose}
      footer={
        <>
          {problems[0] && (
            <span className="small muted" style={{ marginRight: 'auto' }}>
              {problems[0]}
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending || problems.length > 0}>
            {user ? 'Save changes' : 'Add user'}
          </button>
        </>
      }
    >
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20 }}>
        <div className="grid">
          <Field label="Name">
            <input
              className="in"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="Email" hint="Used to sign in.">
            <input
              className="in"
              type="email"
              autoComplete="off"
              value={draft.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
          <Field
            label={user ? 'New password' : 'Password'}
            hint={
              user
                ? 'Leave empty to keep the current password. Setting one signs the user out everywhere.'
                : `At least ${PASSWORD_MIN_LENGTH} characters. Share it with the user securely.`
            }
          >
            <input
              className="in"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </Field>
          <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
            <div style={isSelf ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
              <Segmented<UserRole>
                options={[
                  { id: 'member', label: 'Member' },
                  { id: 'admin', label: 'Admin' },
                ]}
                value={draft.role}
                onChange={(role) => set({ role })}
              />
            </div>
          </Field>
          <div className="row" style={{ gap: 10, opacity: isSelf ? 0.55 : 1 }}>
            <Toggle
              checked={draft.active}
              onChange={(active) => !isSelf && set({ active })}
              label="Account active"
            />
            <span className="small">
              {draft.active ? 'Active — can sign in' : 'Disabled — cannot sign in'}
            </span>
          </div>
        </div>

        <div>
          <div className="row small" style={{ marginBottom: 6 }}>
            <b>Project access</b>
            <div className="grow" />
            {draft.role === 'member' && projects.length > 0 && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() =>
                  set({
                    projectIds: draft.projectIds.length === projects.length ? [] : projects.map((p) => p.id),
                  })
                }
              >
                {draft.projectIds.length === projects.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          {draft.role === 'admin' ? (
            <div className="banner">Admins can open every project, including ones created later.</div>
          ) : projects.length ? (
            <div className="panel access-list">
              {projects.map((p) => (
                <label key={p.id} className="access-item">
                  <input
                    type="checkbox"
                    checked={draft.projectIds.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                  />
                  <div>
                    <b>{p.name}</b>
                    {p.team && <div className="small muted">{p.team}</div>}
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="small muted">No projects yet.</div>
          )}
          {draft.role === 'member' && (
            <p className="small muted">
              {draft.projectIds.length
                ? `${draft.projectIds.length} of ${projects.length} projects selected.`
                : 'No projects selected — this user will only see projects they create themselves.'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
