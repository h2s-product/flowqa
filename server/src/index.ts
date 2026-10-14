/** Bootstrap server: database → data awal → service → HTTP server + scheduler. */
import { createApp } from './app';
import { createAppContext, recoverInterruptedRuns } from './app-context';
import { config } from './config';
import { openDatabase } from './db/database';
import { seedDemoData } from './db/seed';
import { UndiciHttpClient } from './engine/http-client';
import { log } from './lib/log';
import { createRepositories } from './repositories';
import { migrateLegacyApiGroups } from './services/folder-service';
import { SchedulerService } from './services/scheduler-service';

const db = openDatabase(config.dbFile);
const repos = createRepositories(db);
recoverInterruptedRuns(repos);
if (config.seedDemo) seedDemoData(repos, config.publicUrl);

const ctx = createAppContext(repos, new UndiciHttpClient());
const migratedApis = migrateLegacyApiGroups(repos.apis, ctx.apiFolders);
if (migratedApis) log.info(`moved ${migratedApis} API(s) from groups into folders`);

if (ctx.auth.setupRequired && config.admin.email && config.admin.password) {
  await ctx.auth.createUser(config.admin);
  log.info(`admin account created for ${config.admin.email}`);
} else if (ctx.auth.setupRequired) {
  log.info('no accounts yet — open the web UI to create the first admin account');
}

const scheduler = new SchedulerService(repos, ctx.runs, config.schedulerIntervalMs, ctx.uiSchedules);
const server = createApp(ctx).listen(config.port, () => {
  scheduler.start();
  log.info(`API ready on http://localhost:${config.port}  (database: ${config.dbFile})`);
});

function shutdown() {
  scheduler.stop();
  ctx.perf.stopAll();
  void ctx.recorder.closeAll();
  void ctx.inspector.closeAll();
  void ctx.android.server.stop();
  ctx.firebase.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
