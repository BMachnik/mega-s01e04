import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import type { ReadNight } from '../digest/types.js';

const nightPattern = /^\d{4}-\d{2}-\d{2}$/;

export function registerDigestJson(app: Hono, config: RigConfig, readNight: ReadNight): void {
  app.get('/api/digest/:night', (context) => {
    const night = context.req.param('night');
    if (!nightPattern.test(night)) {
      return context.json({ error: 'Invalid night' }, 404);
    }

    try {
      const digest = readNight(config.runsDir, night);
      if (digest === null) {
        return context.json({ error: 'No run log for this night' }, 404);
      }

      return context.json({ rows: digest.rows, badLines: digest.badLines });
    } catch {
      return context.json({ error: 'Unable to read the run log' }, 500);
    }
  });
}
