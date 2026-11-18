import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import type { NightDigest, ReadNight } from '../digest/types.js';
import { lane } from '../lane.js';
import { Digest } from '../views/digest.js';
import { Layout } from '../views/layout.js';

export function registerDigestPage(app: Hono, config: RigConfig, readNight: ReadNight) {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const currentLane = lane();
    let digest: NightDigest | null = null;

    if (night.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(night)) {
      try {
        digest = readNight(config.runsDir, night);
      } catch {
        return c.html(
          <Layout title="Morning digest" lane={currentLane}>
            <h1>Unable to read the run log</h1>
          </Layout>,
          500,
        );
      }
    }

    if (digest === null) {
      return c.html(
        <Layout title="Morning digest" lane={currentLane}>
          <h1>No run log for this night</h1>
        </Layout>,
        404,
      );
    }

    const title = `Morning digest · ${night}`;
    return c.html(
      <Layout title={title} lane={currentLane}>
        <Digest title={title} digest={digest} />
      </Layout>,
    );
  });
}
