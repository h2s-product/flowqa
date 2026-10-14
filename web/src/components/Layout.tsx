import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useProjects } from '@/api/queries';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ChangePasswordModal } from '@/features/users/ChangePasswordModal';
import { envColor } from '@/lib/format';
import { PLATFORM, PRODUCTS, useProductMode, type ProductMode } from '@/lib/mode';
import { Icon, type IconName } from './Icon';
import { IconButton } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  adminOnly?: boolean;
}

/** Menu bertingkat, mis. Settings → Email Report. */
interface NavGroup {
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;
const isGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;

/** Pengaturan aplikasi (khusus admin), sama di kedua mode. */
const SETTINGS_NAV: NavGroup = {
  label: 'Settings',
  icon: 'settings',
  adminOnly: true,
  children: [
    { to: '/settings/email', label: 'Email Report', icon: 'mail', adminOnly: true },
    { to: '/settings/android', label: 'Mobile (Android)', icon: 'android', adminOnly: true },
  ],
};

const SHARED_NAV: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/environments', label: 'Environments', icon: 'globe' },
];

const NAV: Record<ProductMode, NavEntry[]> = {
  api: [
    { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
    ...SHARED_NAV,
    { to: '/apis', label: 'API Catalog', icon: 'code' },
    { to: '/scenarios', label: 'Test Scenarios', icon: 'flow' },
    { to: '/runs', label: 'Test Runs', icon: 'pulse' },
    { to: '/reports', label: 'Reports', icon: 'report' },
    { to: '/performance', label: 'Performance', icon: 'gauge' },
    { to: '/schedules', label: 'Schedules', icon: 'clock' },
    { to: '/users', label: 'Users', icon: 'users', adminOnly: true },
    SETTINGS_NAV,
  ],
  ui: [
    { to: '/ui/tests', label: 'UI Test Cases', icon: 'cursor' },
    { to: '/ui/runs', label: 'UI Test Runs', icon: 'pulse' },
    { to: '/ui/reports', label: 'Reports', icon: 'report' },
    { to: '/ui/schedules', label: 'Test Scheduler', icon: 'clock' },
    ...SHARED_NAV,
    { to: '/users', label: 'Users', icon: 'users', adminOnly: true },
    SETTINGS_NAV,
  ],
  e2e: [
    { to: '/e2e/flows', label: 'E2E Flows', icon: 'flow' },
    { to: '/e2e/runs', label: 'Flow Runs', icon: 'pulse' },
    ...SHARED_NAV,
    { to: '/users', label: 'Users', icon: 'users', adminOnly: true },
    SETTINGS_NAV,
  ],
};

const MODE_ICON: Record<ProductMode, IconName> = { api: 'code', ui: 'cursor', e2e: 'flow' };

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Dashboard'],
  [/^\/projects\/[^/]+/, 'Project overview'],
  [/^\/projects/, 'Projects'],
  [/^\/environments/, 'Environments'],
  [/^\/apis/, 'API Catalog'],
  [/^\/scenarios\/[^/]+/, 'Scenario builder'],
  [/^\/scenarios/, 'Test Scenarios'],
  [/^\/runs\/[^/]+/, 'Run details'],
  [/^\/runs/, 'Test Runs'],
  [/^\/reports/, 'Test Report'],
  [/^\/performance\/runs\/[^/]+/, 'Performance run'],
  [/^\/performance/, 'Performance & Stress Tests'],
  [/^\/schedules/, 'Schedules'],
  [/^\/users/, 'User Administration'],
  [/^\/settings\/email/, 'Settings · Email Report'],
  [/^\/settings\/android/, 'Settings · Mobile (Android)'],
  [/^\/ui\/mobile\/[^/]+/, 'Mobile Inspector'],
  [/^\/ui\/tests\/[^/]+/, 'UI test case'],
  [/^\/ui\/tests/, 'UI Test Cases'],
  [/^\/ui\/record\/[^/]+/, 'Recording'],
  [/^\/ui\/runs\/[^/]+/, 'UI run details'],
  [/^\/ui\/runs/, 'UI Test Runs'],
  [/^\/ui\/reports/, 'UI Test Report'],
  [/^\/ui\/schedules/, 'Test Scheduler'],
  [/^\/e2e\/flows\/[^/]+/, 'E2E flow'],
  [/^\/e2e\/flows/, 'E2E Flows'],
  [/^\/e2e\/runs\/[^/]+/, 'Flow run'],
  [/^\/e2e\/runs/, 'Flow Runs'],
];

/** Kerangka aplikasi: sidebar navigasi, topbar (pemilih environment) dan area halaman. */
export function Layout() {
  const { project, environments, environment, setProjectId, setEnvironmentId } = useWorkspace();
  const { data: projects = [] } = useProjects();
  const { user, logout } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const mode = useProductMode();
  const product = PRODUCTS[mode];
  const title = TITLES.find(([re]) => re.test(location.pathname))?.[1] ?? '';

  useEffect(() => {
    document.title = title ? `${title} · ${PLATFORM.name}` : PLATFORM.name;
  }, [title]);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <img className="brand-logo" src="/logo-mark.png" alt="" width={34} height={34} />
          <div>
            <b>{PLATFORM.name}</b>
            <small>{product.name}</small>
          </div>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Choose tester">
          {(Object.keys(PRODUCTS) as ProductMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => mode !== m && navigate(PRODUCTS[m].home)}
            >
              <Icon name={MODE_ICON[m]} size={14} />
              {PRODUCTS[m].name}
            </button>
          ))}
        </div>
        {projects.length > 0 && (
          <label className="proj-switch">
            <span>Project</span>
            <select value={project?.id} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <nav className="nav">
          {NAV[mode]
            .filter((item) => !item.adminOnly || user?.role === 'admin')
            .map((item) =>
              isGroup(item) ? (
                <NavSection key={item.label} group={item} pathname={location.pathname} />
              ) : (
                <NavEntryLink key={item.to} item={item} />
              ),
            )}
        </nav>
        {user && (
          <div className="side-user">
            <span className="avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div className="who">
              <b>{user.name}</b>
              <small>{user.role === 'admin' ? `Admin · ${user.email}` : user.email}</small>
            </div>
            <IconButton
              icon="key"
              label="Change password"
              size={16}
              onClick={() => setChangingPassword(true)}
            />
            <IconButton icon="logout" label="Log out" size={16} onClick={() => logout()} />
          </div>
        )}
        <div className="side-foot">{PLATFORM.name} v1.0 · running locally</div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <div className="crumb">{project?.name ?? 'No project yet'}</div>
            <h1>{title}</h1>
          </div>
          <div className="grow" />
          {environment && (
            <div className="env-pick">
              <span className="env-dot" style={{ background: envColor(environment.name) }} />
              <label htmlFor="envsel">Environment</label>
              <select id="envsel" value={environment.id} onChange={(e) => setEnvironmentId(e.target.value)}>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="page">
          <Outlet />
        </div>
        {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      </main>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function NavEntryLink({ item, sub }: { item: NavItem; sub?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `${isActive ? 'on' : ''} ${sub ? 'sub' : ''}`}
    >
      <Icon name={item.icon} size={sub ? 15 : 17} />
      <span>{item.label}</span>
    </NavLink>
  );
}

/** Grup menu yang bisa dibuka/tutup; otomatis terbuka saat salah satu sub-menunya aktif. */
function NavSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = group.children.some((c) => pathname.startsWith(c.to));
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  return (
    <>
      <button
        type="button"
        className={`nav-group ${active ? 'active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={group.icon} size={17} />
        <span className="grow">{group.label}</span>
        <span className={`tree-caret ${open ? 'open' : ''}`} aria-hidden="true">
          <Icon name="down" size={12} />
        </span>
      </button>
      {open && group.children.map((child) => <NavEntryLink key={child.to} item={child} sub />)}
    </>
  );
}
