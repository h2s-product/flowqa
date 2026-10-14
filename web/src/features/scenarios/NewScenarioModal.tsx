import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApis, useCreateScenario } from '@/api/queries';
import { FolderSelect } from '@/components/folders/FolderSelect';
import type { FolderIndex } from '@/components/folders/folderIndex';
import { Modal } from '@/components/Modal';
import { Field } from '@/components/ui';
import { createApiStep } from '../builder/step-factory';

export function NewScenarioModal({
  projectId,
  folderIndex,
  defaultFolderId = null,
  onClose,
}: {
  projectId: string;
  folderIndex: FolderIndex;
  /** Folder awal (folder yang sedang dibuka). */
  defaultFolderId?: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [description, setDescription] = useState('');
  const [withLogin, setWithLogin] = useState(true);
  const { data: apis = [] } = useApis(projectId);
  const create = useCreateScenario(projectId);
  const navigate = useNavigate();
  const loginApi = apis.find((a) => /login|signin|auth\/token/i.test(a.path));

  const submit = () => {
    const steps = withLogin && loginApi ? [createApiStep(loginApi, { captureToken: true })] : [];
    create.mutate(
      { name, description, steps, folderId },
      {
        onSuccess: (s) => (onClose(), navigate(`/scenarios/${s.id}`)),
      },
    );
  };

  return (
    <Modal
      title="New scenario"
      subtitle="A scenario is one user journey, tested step by step."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim() || create.isPending}>
            Create and open
          </button>
        </>
      }
    >
      <div className="grid">
        <Field label="Scenario name">
          <input
            className="in"
            autoFocus
            value={name}
            placeholder="Customer Purchase Flow"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()}
          />
        </Field>
        <Field label="What does it prove?">
          <input
            className="in"
            value={description}
            placeholder="A new customer can order and pay"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Folder">
          <FolderSelect index={folderIndex} value={folderId} onChange={setFolderId} />
        </Field>
        {loginApi && (
          <label className="row small">
            <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} />{' '}
            Start with the “{loginApi.name}” step
          </label>
        )}
      </div>
    </Modal>
  );
}
