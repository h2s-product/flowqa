import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config';
import { errorHandler } from './lib/http';
import { demoSalesApi } from './demo/demo-sales-api';
import { demoWeb } from './demo/demo-web';
import { apiRoutes } from './routes/apis';
import { authRoutes, requireAuth, requireClientHeader } from './routes/auth';
import type { AppContext } from './routes/context';
import { dashboardRoutes } from './routes/dashboard';
import { environmentRoutes } from './routes/environments';
import { folderRoutes } from './routes/folders';
import { notificationRoutes } from './routes/notifications';
import { perfRoutes } from './routes/perf';
import { settingsRoutes } from './routes/settings';
import { projectRoutes } from './routes/projects';
import { reportRoutes } from './routes/reports';
import { runRoutes } from './routes/runs';
import { scenarioRoutes } from './routes/scenarios';
import { scheduleRoutes } from './routes/schedules';
import { androidRoutes } from './routes/android';
import { firebaseRoutes } from './routes/firebase';
import { e2eFlowRoutes } from './routes/e2e-flows';
import { mobileInspectorRoutes } from './routes/mobile-inspector';
import { uiRecordingRoutes } from './routes/ui-recordings';
import { uiTestRoutes } from './routes/ui-tests';
import { uiScheduleRoutes } from './routes/ui-schedules';
import { userRoutes } from './routes/users';

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  const api = express.Router();
  // Health check untuk monitoring: terbuka tanpa login.
  api.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  api.use(requireClientHeader);
  api.use(authRoutes(ctx));
  // Semua endpoint di bawah ini wajib login.
  api.use(requireAuth(ctx));
  api.use(dashboardRoutes(ctx));
  api.use(projectRoutes(ctx));
  api.use(notificationRoutes(ctx));
  api.use(settingsRoutes(ctx));
  api.use(environmentRoutes(ctx));
  api.use(apiRoutes(ctx));
  api.use(folderRoutes(ctx));
  api.use(scenarioRoutes(ctx));
  api.use(runRoutes(ctx));
  api.use(reportRoutes(ctx));
  api.use(scheduleRoutes(ctx));
  api.use(perfRoutes(ctx));
  api.use(userRoutes(ctx));
  api.use(uiTestRoutes(ctx));
  api.use(uiScheduleRoutes(ctx));
  api.use(uiRecordingRoutes(ctx));
  api.use(mobileInspectorRoutes(ctx));
  api.use(androidRoutes(ctx));
  api.use(firebaseRoutes(ctx));
  api.use(e2eFlowRoutes(ctx));
  api.use((_req, res) => res.status(404).json({ error: 'Unknown API route' }));
  app.use('/api', api);

  // Demo API untuk data contoh (lihat mock/demo-sales-api.ts).
  app.use('/demo-api/:mode', demoSalesApi());
  // Demo web shop sebagai target contoh UI Tester.
  app.use('/demo-web', demoWeb());

  // Mode produksi: sajikan UI hasil build (web/dist) + fallback SPA.
  if (fs.existsSync(config.webDistDir)) {
    app.use(express.static(config.webDistDir));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDistDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
