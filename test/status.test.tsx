import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { copySampleRun, withDigestRunsDir } from './support/digest-fixtures.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };
const laneId = 'test-status-lane';
const marker = 'TEST-MARKER';
const sampleNights = [
  { night: '2026-10-28', counts: ['ok 10', 'retry 4', 'fail 1'] },
  { night: '2026-10-27', counts: ['ok 7', 'retry 0', 'fail 0'] },
] as const;

async function withSampleNights(use: (runsDir: string) => Promise<void>) {
  await withDigestRunsDir(async (runsDir) => {
    const copies = await Promise.all(sampleNights.map(({ night }) => copySampleRun(runsDir, night)));
    const before = await Promise.all(copies.map((file) => readFile(file)));
    try {
      await use(runsDir);
    } finally {
      expect(await Promise.all(copies.map((file) => readFile(file)))).toEqual(before);
    }
  });
}

describe('status board', { concurrent: false }, () => {
  beforeEach(() => {
    vi.stubEnv('LANE_ID', laneId);
    vi.stubEnv('LANE_MARKER', marker);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the lane banner and the nights on disk', async () => {
    await withDigestRunsDir(async (runsDir) => {
      await copySampleRun(runsDir, '2026-10-28');
      const response = await createApp({ ...config, runsDir }).request('/');
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain(marker);
      expect(html).toContain(laneId);
      expect(html).toContain('2026-10-28');
      expect(html).toContain('adapter');
      expect(html).toContain(config.adapter);
      expect(html).toContain('installed');
      expect(html).toContain(config.installed);
      expect(html).toContain('last beat');
    });
  });

  it('health answers with the lane id', async () => {
    await withDigestRunsDir(async (runsDir) => {
      const response = await createApp({ ...config, runsDir }).request('/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, lane: laneId });
    });
  });

  it('links both nights to their HTML digests and shows their labelled counts in order', async () => {
    await withSampleNights(async (runsDir) => {
      const app = createApp({ ...config, runsDir });
      const board = await app.request('/');
      expect(board.status).toBe(200);
      const html = await board.text();
      const nightRows = Array.from(html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs), ([, row]) => row);
      const links = nightRows.map((row) => row.match(/<a\b[^>]*\shref="([^"]+)"/)?.[1] ?? '');

      expect(links).toEqual(sampleNights.map(({ night }) => `/digest/${night}`));

      for (const [index, { night, counts }] of sampleNights.entries()) {
        expect(nightRows[index].match(/\b(?:ok|retry|fail)\s+\d+\b/g)).toEqual(counts);
        const digest = await app.request(links[index]);
        expect(digest.status).toBe(200);
        const digestHtml = await digest.text();
        expect(digestHtml).toContain('Morning digest');
        expect(digestHtml).toContain(night);
        expect(digestHtml).toContain('<table');
      }
    });
  });

  it('serves the JSON digest for both nights', async () => {
    await withSampleNights(async (runsDir) => {
      const app = createApp({ ...config, runsDir });

      for (const { night } of sampleNights) {
        const response = await app.request(`/api/digest/${night}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toMatchObject({ rows: expect.any(Array) });
      }
    });
  });

  it('lists only ordinary log files with a nightly name', async () => {
    await withDigestRunsDir(async (runsDir) => {
      await copySampleRun(runsDir, '2026-10-28');
      await mkdir(join(runsDir, '2026-10-26.jsonl'));
      await writeFile(join(runsDir, '2026-10-25.txt'), 'not a nightly log');
      const response = await createApp({ ...config, runsDir }).request('/');
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('2026-10-28');
      expect(html).not.toContain('2026-10-26');
      expect(html).not.toContain('2026-10-25');
    });
  });
});
