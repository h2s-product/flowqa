import type { AppPlatform, ProjectApp } from '@flowqa/shared';
import { useApps } from '@/api/queries';

/** Pilih app project (Android / Web) untuk test case; "No app" = tidak dihubungkan. */
export function AppSelect({
  projectId,
  platform,
  value,
  onChange,
  id,
}: {
  projectId: string;
  platform: AppPlatform;
  value: string | null | undefined;
  onChange: (app: ProjectApp | null) => void;
  id?: string;
}) {
  const { data: apps = [] } = useApps(projectId);
  const options = apps.filter((a) => a.platform === platform);
  return (
    <select
      id={id}
      className="in"
      value={value ?? ''}
      onChange={(e) => onChange(options.find((a) => a.id === e.target.value) ?? null)}
    >
      <option value="">
        {options.length
          ? 'No app'
          : `No ${platform === 'android' ? 'Android' : 'web'} apps yet (add them in Apps)`}
      </option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.platform === 'android' && a.android?.formFactor ? ` · ${a.android.formFactor}` : ''}
        </option>
      ))}
      {value && !options.some((a) => a.id === value) && <option value={value}>Deleted app</option>}
    </select>
  );
}
