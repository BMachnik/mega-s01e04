import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import type { NightDigest, ReadNight } from '../src/digest/types.js';
import { registerDigestJson } from '../src/routes/digest-json.js';

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'synthetic-runs',
};
const night = '2026-10-28';
const digest: NightDigest = {
  rows: [
    {
      job: 'notes/backup',
      owner: null,
      runs: 3,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'quota exceeded',
      firstAt: '2026-10-28T23:00:00+01:00',
      lastAt: '2026-10-28T23:01:00+01:00',
      hadFail: true,
    },
    {
      job: 'digest/render',
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T22:03:00Z',
      lastAt: '2026-10-28T22:03:00Z',
      hadFail: false,
    },
  ],
  badLines: 2,
  counts: { ok: 2, retry: 1, fail: 1 },
};

function createDigestApp(readNight: ReadNight) {
  const app = new Hono();
  registerDigestJson(app, config, readNight);
  return app;
}

describe('JSON digest route', () => {
  it('returns only rows and badLines with reader values and order intact', async () => {
    const expected = structuredClone({ rows: digest.rows, badLines: digest.badLines });
    const readNight = vi.fn<ReadNight>(() => digest);
    const response = await createDigestApp(readNight).request(`/api/digest/${night}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json\b/i);
    expect(await response.json()).toEqual(expected);
    expect(readNight.mock.calls).toEqual([[config.runsDir, night]]);
  });

  it('rejects an invalid night with a JSON 404 before invoking the reader', async () => {
    const readNight = vi.fn<ReadNight>(() => digest);
    const response = await createDigestApp(readNight).request('/api/digest/not-a-night');

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json\b/i);
    expect(await response.json()).toHaveProperty('error');
    expect(readNight).toHaveBeenCalledTimes(0);
  });

  it('returns a JSON 404 when the reader reports a missing night', async () => {
    const readNight = vi.fn<ReadNight>(() => null);
    const response = await createDigestApp(readNight).request(`/api/digest/${night}`);

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json\b/i);
    expect(await response.json()).toHaveProperty('error');
    expect(readNight.mock.calls).toEqual([[config.runsDir, night]]);
  });

  it('returns 500 without disclosing the reader error path', async () => {
    const errorPath = `/synthetic-private/runs/${night}.jsonl`;
    const readNight = vi.fn<ReadNight>(() => {
      throw new Error(`Unable to read ${errorPath}`);
    });
    const response = await createDigestApp(readNight).request(`/api/digest/${night}`);

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('synthetic-private');
    expect(readNight.mock.calls).toEqual([[config.runsDir, night]]);
  });
});
