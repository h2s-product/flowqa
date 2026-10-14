import { useState } from 'react';
import type { Project } from '@flowqa/shared';
import { useNotificationStatus, useSaveProject } from '@/api/queries';
import { Modal } from '@/components/Modal';
import { Field, isValidEmail } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { NotificationSettings, type EmailDraft } from './NotificationSettings';

export function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved?: (p: Project) => void;
}) {
  const [draft, setDraft] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    owner: project?.owner ?? '',
    team: project?.team ?? '',
    tags: (project?.tags ?? []).join(', '),
  });
  const saved = project?.notifications?.email;
  const [email, setEmail] = useState<EmailDraft>({
    enabled: saved?.enabled ?? false,
    recipients: saved?.recipients ?? [],
    when: saved?.when ?? 'always',
  });
  const save = useSaveProject();
  const toast = useToast();
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const { data: notifyStatus } = useNotificationStatus();
  const hasDefaults = (notifyStatus?.defaultRecipients.length ?? 0) > 0;
  // Boleh kosong bila ada penerima default di Settings → Email Report.
  const recipientsInvalid =
    email.enabled && ((!email.recipients.length && !hasDefaults) || !email.recipients.every(isValidEmail));

  const submit = () =>
    save.mutate(
      {
        id: project?.id,
        ...draft,
        tags: draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notifications: {
          email: { enabled: email.enabled, recipients: email.recipients, when: email.when },
        },
      },
      {
        onSuccess: (saved) => {
          toast(project ? 'Project saved' : 'Project created');
          onSaved?.(saved);
          onClose();
        },
      },
    );

  return (
    <Modal
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={save.isPending || !draft.name.trim() || recipientsInvalid}
            title={recipientsInvalid ? 'Add at least one valid email address, or turn email off' : undefined}
          >
            {project ? 'Save changes' : 'Create project'}
          </button>
        </>
      }
    >
      <div className="grid">
        <Field label="Project name">
          <input
            className="in"
            autoFocus
            value={draft.name}
            placeholder="Maxxi Sales API"
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label="Description">
          <input
            className="in"
            value={draft.description}
            placeholder="What does this project cover?"
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Owner">
            <input className="in" value={draft.owner} onChange={(e) => set({ owner: e.target.value })} />
          </Field>
          <Field label="Team">
            <input className="in" value={draft.team} onChange={(e) => set({ team: e.target.value })} />
          </Field>
        </div>
        <Field label="Tags" hint="Separate with commas.">
          <input
            className="in"
            value={draft.tags}
            placeholder="sales, uat"
            onChange={(e) => set({ tags: e.target.value })}
          />
        </Field>
        <NotificationSettings
          projectId={project?.id}
          value={email}
          onChange={(patch) => setEmail((e) => ({ ...e, ...patch }))}
        />
      </div>
    </Modal>
  );
}
