import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDashboard, useProjects, useSchedules } from '@/api/queries';
import { EmptyState, Loading } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ImportApisModal } from '../apis/ImportApisModal';
import { DateTime } from '@/components/DateTime';

export function ProjectOverviewPage() {
  const { projectId = '' } = useParams();
  const { setProjectId } = useWorkspace();
  const { data: projects, isLoading } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  // Jumlah API/environment/scenario sudah dihitung server (project.stats); run & pass rate dari dashboard.
  const { data: dashboard } = useDashboard(project ? projectId : undefined);
  const schedules = useSchedules(project ? projectId : undefined).data ?? [];
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (project) setProjectId(projectId);
  }, [project, projectId, setProjectId]);
  if (isLoading) return <Loading />;
  if (!project)
    return (
      <div className="panel">
        <EmptyState
          title="Project not found"
          action={
            <Link className="btn" to="/projects">
              Back to projects
            </Link>
          }
        >
          It may have been deleted, or you don't have access to it.
        </EmptyState>
      </div>
    );

  const runs = dashboard?.totals.totalRuns ?? 0;
  const sections = [
    ['APIs', project.stats.apis, '/apis', 'Endpoints this project tests'],
    ['Environments', project.stats.environments, '/environments', 'Where tests run'],
    ['Test scenarios', project.stats.scenarios, '/scenarios', 'End-to-end flows'],
    ['Test runs (14 days)', runs, '/runs', runs ? `${dashboard?.totals.passRate}% passed` : 'No runs yet'],
    ['Schedules', schedules.length, '/schedules', 'Automatic runs'],
  ] as const;

  return (
    <>
      <div className="panel panel-b" style={{ marginBottom: 16 }}>
        <div className="row wrap">
          <div className="grow">
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{project.name}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {project.description}
            </p>
          </div>
          <div className="small" style={{ textAlign: 'right', color: 'var(--ink2)' }}>
            Owner <b>{project.owner || '—'}</b>
            <br />
            {project.team}
            <div className="muted" style={{ marginTop: 4 }}>
              Created <DateTime value={project.createdAt} /> · Updated <DateTime value={project.updatedAt} />
            </div>
          </div>
        </div>
      </div>
      <div className="proj-cards">
        {sections.map(([label, count, to, desc]) => (
          <Link key={label} to={to} className="panel proj-card plain">
            <span className="muted small">{label}</span>
            <b style={{ fontSize: 26 }}>{count}</b>
            <span className="small muted">{desc}</span>
          </Link>
        ))}
      </div>
      {!project.stats.apis && (
        <div className="panel" style={{ marginTop: 16 }}>
          <EmptyState
            title="Start by adding the APIs you want to test"
            action={
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => setImporting(true)}>
                  Import OpenAPI / Swagger
                </button>
                <Link className="btn" to="/apis">
                  Add API manually
                </Link>
              </div>
            }
          >
            Import an OpenAPI or Swagger file, or add endpoints one by one.
          </EmptyState>
        </div>
      )}
      {importing && <ImportApisModal projectId={projectId} onClose={() => setImporting(false)} />}
    </>
  );
}
