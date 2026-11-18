import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, ReadNight } from '../src/digest/types.js';

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'test-runs',
};
const night = '2026-10-28';
const laneId = 'test-digest-lane';
const marker = 'TEST-DIGEST-MARKER';

const successfulRow = {
  owner: 'rook',
  lastStatus: 'ok',
  lastError: null,
  firstAt: '2026-10-28T23:01:00+02:00',
  lastAt: '2026-10-28T23:02:00+02:00',
  hadFail: false,
} satisfies Omit<DigestRow, 'job' | 'runs' | 'retries'>;

async function requestDigest(readNight: ReadNight, requestedNight = night) {
  // Load the route during the test so the contract typechecks before the file exists.
  const { registerDigestPage } = await vi.importActual<{
    registerDigestPage: (app: Hono, config: RigConfig, readNight: ReadNight) => void;
  }>('../src/routes/digest-page.tsx');
  const app = new Hono();
  registerDigestPage(app, config, readNight);
  const response = await app.request(`/digest/${requestedNight}`);
  return { status: response.status, html: await response.text() };
}

function textOf(markup: string) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cellsFor(html: string, job: string) {
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].find(([, cells]) =>
    [...cells.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].some(([, heading]) => textOf(heading) === job),
  );
  expect(row, `Expected a row header for ${job}`).toBeDefined();
  return [...(row?.[1] ?? '').matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)].map(([cell]) => cell);
}

const warnClass = /\bclass=["'](?:[^"']*\s)?warn(?:\s[^"']*)?["']/;

describe('digest page', () => {
  beforeEach(() => {
    vi.stubEnv('LANE_ID', laneId);
    vi.stubEnv('LANE_MARKER', marker);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T5 renders the lane banner, viewport, named table and retry and failure markers', async () => {
    const rows: DigestRow[] = [
      { ...successfulRow, job: 'digest/four', runs: 5, retries: 4 },
      { ...successfulRow, job: 'digest/recovered', runs: 2, retries: 0, hadFail: true, lastError: 'upstream unavailable' },
      { ...successfulRow, job: 'digest/three', runs: 4, retries: 3 },
      { ...successfulRow, job: 'digest/two', owner: null, runs: 3, retries: 2 },
    ];
    const readNight = vi.fn<ReadNight>(() => ({ rows, badLines: 1, counts: { ok: 4, retry: 9, fail: 1 } }));
    const { status, html } = await requestDigest(readNight);

    expect(status).toBe(200);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, night);
    const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(textOf(header)).toContain(laneId);
    expect(textOf(header)).toContain(marker);
    const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/)?.[0] ?? '';
    const viewport = head.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/)?.[0] ?? '';
    expect(viewport).toMatch(/\bcontent=["']width=device-width, initial-scale=1["']/);
    expect(textOf(html)).toContain(`Morning digest · ${night}`);
    expect(textOf(html)).toContain('Skipped 1 malformed log line');

    const tables = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)];
    expect(tables).toHaveLength(1);
    const [, tableAttributes, tableBody] = tables[0];
    const caption = tableBody.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/)?.[1] ?? '';
    const hasTableLabel = /\baria-label(?:ledby)?=["'][^"']+/.test(tableAttributes) || textOf(caption).length > 0;
    expect(hasTableLabel, 'Expected an accessible table name').toBe(true);
    const columnRow = tableBody.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/)?.[1] ?? '';
    const headings = [...columnRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(([, heading]) => textOf(heading));
    expect(headings).toEqual(['Job', 'Owner', 'Runs', 'Retries', 'Last status', 'Last error', 'First time', 'Last time']);

    const [owner, runs, twoRetries, , lastError, firstTime, lastTime] = cellsFor(tableBody, 'digest/two');
    expect(textOf(owner)).toBe('—');
    expect(owner).toMatch(/\baria-label=["']Unknown owner["']/);
    expect(textOf(runs)).toBe('3');
    expect(textOf(twoRetries)).toMatch(/^2(?: retries)?$/);
    expect(twoRetries).not.toMatch(warnClass);
    expect(textOf(lastError)).toBe('—');
    expect(textOf(firstTime)).toBe(successfulRow.firstAt);
    expect(textOf(lastTime)).toBe(successfulRow.lastAt);

    const threeRetries = cellsFor(tableBody, 'digest/three')[2];
    expect(textOf(threeRetries)).toBe('3 retries');
    expect(threeRetries).toMatch(warnClass);
    const fourRetries = cellsFor(tableBody, 'digest/four')[2];
    expect(textOf(fourRetries)).toBe('4 retries');
    expect(fourRetries).toMatch(warnClass);
    const [, , , recoveredStatus, recoveredError] = cellsFor(tableBody, 'digest/recovered');
    expect(textOf(recoveredStatus)).toMatch(/\bok\b/);
    expect(textOf(recoveredStatus)).toContain('fail observed');
    expect(recoveredStatus).toMatch(warnClass);
    expect(textOf(recoveredError)).toBe('upstream unavailable');
  });

  it('T5 renders fields from the log as text', async () => {
    const row: DigestRow = {
      ...successfulRow,
      job: '<i>job</i>',
      owner: '<i>owner</i>',
      lastError: '<i>error</i>',
      runs: 2,
      retries: 1,
    };
    const { status, html } = await requestDigest(() => ({ rows: [row], badLines: 0, counts: { ok: 1, retry: 1, fail: 0 } }));

    expect(status).toBe(200);
    for (const value of ['job', 'owner', 'error']) {
      expect(html).toContain(`&lt;i&gt;${value}&lt;/i&gt;`);
    }
    expect(html).not.toMatch(/<i\b[^>]*>(?:job|owner|error)<\/i>/);
  });

  it('T5 shows an empty state for an existing night with no events', async () => {
    const { status, html } = await requestDigest(() => ({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } }));

    expect(status).toBe(200);
    expect(textOf(html)).toContain('nothing ran');
  });

  it('T6 rejects an invalid night before calling the reader', async () => {
    const readNight = vi.fn<ReadNight>(() => null);
    const { status } = await requestDigest(readNight, 'invalid-night');

    expect(status).toBe(404);
    expect(readNight).toHaveBeenCalledTimes(0);
  });

  it('T6 keeps the standard banner when a night is missing', async () => {
    const readNight = vi.fn<ReadNight>(() => null);
    const { status, html } = await requestDigest(readNight);

    expect(status).toBe(404);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, night);
    expect(textOf(html)).toContain('No run log for this night');
    const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(textOf(header)).toContain(laneId);
    expect(textOf(header)).toContain(marker);
  });

  it('T6 returns a generic 500 after a read error', async () => {
    const privatePath = '/synthetic/test-runs/2026-10-28.jsonl';
    const readNight = vi.fn<ReadNight>(() => {
      throw new Error(`EIO while reading ${privatePath}`);
    });
    const { status, html } = await requestDigest(readNight);

    expect(status).toBe(500);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, night);
    expect(textOf(html)).toMatch(/error|unable|failed|could not|unexpected/i);
    expect(html).not.toContain(privatePath);
    expect(html).not.toContain('EIO while reading');
  });
});
