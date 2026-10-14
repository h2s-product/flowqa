import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ApiCatalogPage } from './features/apis/ApiCatalogPage';
import { ScenarioBuilderPage } from './features/builder/ScenarioBuilderPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { EnvironmentsPage } from './features/environments/EnvironmentsPage';
import { PerfRunDetailPage } from './features/performance/PerfRunDetailPage';
import { PerformancePage } from './features/performance/PerformancePage';
import { ProjectOverviewPage } from './features/projects/ProjectOverviewPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { RunDetailPage } from './features/runs/RunDetailPage';
import { ReportPage } from './features/reports/ReportPage';
import { FlowEditorPage } from './features/e2e/FlowEditorPage';
import { FlowRunDetailPage } from './features/e2e/FlowRunDetailPage';
import { FlowRunsPage } from './features/e2e/FlowRunsPage';
import { FlowsPage } from './features/e2e/FlowsPage';
import { AndroidSettingsPage } from './features/settings/AndroidSettingsPage';
import { EmailSettingsPage } from './features/settings/EmailSettingsPage';
import { RunsPage } from './features/runs/RunsPage';
import { ScenariosPage } from './features/scenarios/ScenariosPage';
import { SchedulesPage } from './features/schedules/SchedulesPage';
import { MobileInspectorPage } from './features/ui/MobileInspectorPage';
import { RecorderPage } from './features/ui/RecorderPage';
import { UiRunDetailPage } from './features/ui/UiRunDetailPage';
import { UiRunsPage } from './features/ui/UiRunsPage';
import { UiSchedulesPage } from './features/ui/UiSchedulesPage';
import { UiTestEditorPage } from './features/ui/UiTestEditorPage';
import { UiTestsPage } from './features/ui/UiTestsPage';
import { UsersPage } from './features/users/UsersPage';
import { useAuth } from './context/AuthContext';

export function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectOverviewPage />} />
        <Route path="environments" element={<EnvironmentsPage />} />
        <Route path="apis" element={<ApiCatalogPage />} />
        <Route path="scenarios" element={<ScenariosPage />} />
        <Route path="scenarios/:scenarioId" element={<ScenarioBuilderPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="reports" element={<ReportPage key="api" kind="api" />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="performance/runs/:runId" element={<PerfRunDetailPage />} />
        <Route path="users" element={user?.role === 'admin' ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="settings" element={<Navigate to="/settings/email" replace />} />
        <Route path="settings/email" element={<EmailSettingsPage />} />
        <Route path="settings/android" element={<AndroidSettingsPage />} />
        <Route path="settings/appium" element={<Navigate to="/settings/android" replace />} />
        <Route path="ui" element={<Navigate to="/ui/tests" replace />} />
        <Route path="ui/tests" element={<UiTestsPage />} />
        <Route path="ui/tests/:testId" element={<UiTestEditorPage />} />
        <Route path="ui/record/:sessionId" element={<RecorderPage />} />
        <Route path="ui/mobile/:sessionId" element={<MobileInspectorPage />} />
        <Route path="ui/runs" element={<UiRunsPage />} />
        <Route path="ui/runs/:runId" element={<UiRunDetailPage />} />
        <Route path="ui/reports" element={<ReportPage key="ui" kind="ui" />} />
        <Route path="ui/schedules" element={<UiSchedulesPage />} />
        <Route path="e2e" element={<Navigate to="/e2e/flows" replace />} />
        <Route path="e2e/flows" element={<FlowsPage />} />
        <Route path="e2e/flows/:flowId" element={<FlowEditorPage />} />
        <Route path="e2e/runs" element={<FlowRunsPage />} />
        <Route path="e2e/runs/:runId" element={<FlowRunDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
