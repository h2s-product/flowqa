import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@flowqa/shared';
import { useProjects } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, Loading } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ProjectFormModal } from './ProjectFormModal';
import { DateTime } from '@/components/DateTime';

export function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects();
  const { projectId, setProjectId } = useWorkspace();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const open = (id: string) => {
    setProjectId(id);
    navigate(`/projects/${id}`);
  };

  return (
    <>
      <div className="row wrap toolbar">
        <p className="muted" style={{ margin: 0 }}>
          A project groups the APIs, environments and scenarios for one product or service.
        </p>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> New project
        </button>
      </div>

      {projects?.length ? (
        <div className="proj-cards">
          {projects.map((p) => (
            <article className="panel proj-card" key={p.id}>
              <div className="row">
                <h3 className="grow">{p.name}</h3>
                {p.id === projectId && <span className="chip var-out">current</span>}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {p.description || 'No description'}
              </p>
              <div className="tags">
                {p.tags.map((t) => (
                  <span key={t} className="chip plain">
                    {t}
                  </span>
                ))}
              </div>
              <div className="small" style={{ color: 'var(--ink2)' }}>
                {p.stats.apis} APIs · {p.stats.scenarios} scenarios · Owner {p.owner || '—'}{' '}
                {p.team && `· ${p.team}`}
              </div>
              <div className="small muted">
                {p.stats.lastRun ? (
                  <>
                    Last run <DateTime value={p.stats.lastRun.startedAt} relative /> ·{' '}
                    <span
                      style={{
                        color: p.stats.lastRun.status === 'passed' ? 'var(--green-ink)' : 'var(--red)',
                      }}
                    >
                      {p.stats.lastRun.status}
                    </span>
                  </>
                ) : (
                  'No runs yet'
                )}
              </div>
              <div className="small muted">
                Created <DateTime value={p.createdAt} /> · Updated <DateTime value={p.updatedAt} />
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn sm primary" onClick={() => open(p.id)}>
                  Open project
                </button>
                <button className="btn sm ghost" onClick={() => setEditing(p)}>
                  Edit details
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title="No projects yet"
            action={
              <button className="btn primary" onClick={() => setEditing('new')}>
                Create your first project
              </button>
            }
          >
            Start with the product or service you want to test.
          </EmptyState>
        </div>
      )}

      {editing && (
        <ProjectFormModal
          project={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => editing === 'new' && open(p.id)}
        />
      )}
    </>
  );
}
