import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { buildNightSummaries } from './digest/night-summaries.js';
import { readNight } from './digest/read-night.js';
import { lane } from './lane.js';
import { registerDigestJson } from './routes/digest-json.js';
import { registerDigestPage } from './routes/digest-page.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) => {
    const status = readStatus(config);
    const summaries = buildNightSummaries(status.nights, config.runsDir, readNight);
    return c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={status} summaries={summaries} />
      </Layout>,
    );
  });

  registerDigestPage(app, config, readNight);
  registerDigestJson(app, config, readNight);

  return app;
}
