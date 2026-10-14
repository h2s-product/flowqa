/**
 * Menyimpan project & environment yang sedang aktif (persist di localStorage).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Environment } from '@flowqa/shared';
import { useEnvironments, useProjects, type ProjectWithStats } from '@/api/queries';

interface Workspace {
  project?: ProjectWithStats;
  projectId?: string;
  environment?: Environment;
  environments: Environment[];
  setProjectId: (id: string) => void;
  setEnvironmentId: (id: string) => void;
  loading: boolean;
}

const WorkspaceContext = createContext<Workspace | null>(null);
const STORAGE_KEY = 'flowqa.workspace';

function readStored(): { projectId?: string; environments?: Record<string, string> } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const stored = readStored();
  const [projectId, setProjectIdState] = useState<string | undefined>(stored.projectId);
  const [envByProject, setEnvByProject] = useState<Record<string, string>>(stored.environments ?? {});
  const projects = useProjects();

  const project = projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0];
  const environments = useEnvironments(project?.id);
  const envList = environments.data ?? [];
  const environment = envList.find((e) => e.id === envByProject[project?.id ?? '']) ?? envList[0];

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ projectId: project?.id, environments: envByProject }),
      );
    } catch {
      /* storage tidak tersedia */
    }
  }, [project?.id, envByProject]);

  const value = useMemo<Workspace>(
    () => ({
      project,
      projectId: project?.id,
      environment,
      environments: envList,
      setProjectId: setProjectIdState,
      setEnvironmentId: (id) => project && setEnvByProject((prev) => ({ ...prev, [project.id]: id })),
      loading: projects.isLoading,
    }),
    [project, environment, envList, projects.isLoading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
