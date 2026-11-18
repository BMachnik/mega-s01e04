import type { Dirent, PathLike } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import type { DigestRow } from '../src/digest/types.js';
import { copySampleRun, withDigestRunsDir } from './support/digest-fixtures.js';

type App = ReturnType<typeof import('../src/app.js').createApp>;
type FsModule = typeof import('node:fs');

const prefixes = ['/digest', '/api/digest'];
const sampleNight = '2026-10-28';
const wrongName = 'not-a-night';
const directoryNight = '2026-10-29';
const linkNight = '2026-10-30';
const fixtureJob = 'fixture/route-boundary';
const fixtureTime = '2026-10-30T23:15:00+01:00';
const validLine = JSON.stringify({ job: fixtureJob, owner: null, status: 'ok', at: fixtureTime });
const malformedLine = '{"job":';
const missingMessage = 'No run log for this night';
const warningMessage = 'Skipped 1 malformed log line';

async function appFor(runsDir: string) {
  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  const { createApp } = await import('../src/app.js');
  return createApp(config);
}

async function digestResponses(app: App, night: string) {
  const page = await app.request('/digest/' + night);
  const api = await app.request('/api/digest/' + night);
  expect(page.headers.get('content-type')).toMatch(/^text\/html\b/);
  expect(api.headers.get('content-type')).toMatch(/^application\/json\b/);
  return { pageStatus: page.status, apiStatus: api.status, html: await page.text(), json: await api.json() };
}

async function expectMissingNight(app: App, night: string) {
  const result = await digestResponses(app, night);
  expect(result.pageStatus).toBe(404);
  expect(result.apiStatus).toBe(404);
  expect(result.html).toContain(missingMessage);
  expect(result.html).toContain('TEST-DIGEST-ROUTES');
  expect(result.json).toStrictEqual({ error: missingMessage });
}

const htmlEntities: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
};

function textOf(markup: string) {
  return markup.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (entity) => htmlEntities[entity]).trim();
}

function visibleDigestRows(html: string) {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), ([, row]) => {
    const heading = row.match(/<th\b[^>]*\bscope="row"[^>]*>([\s\S]*?)<\/th>/);
    expect(heading, 'digest row heading').not.toBeNull();
    const cells = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), ([, cell]) => textOf(cell));
    expect(cells).toHaveLength(7);
    const [owner, runs, retries, status, error, firstAt, lastAt] = cells;
    expect(runs).toMatch(/^\d+$/);
    expect(retries).toMatch(/^\d+(?: retries)?$/);
    const result = /^(ok|retry|fail)( · fail observed)?$/.exec(status);
    expect(result, 'last status and failure indicator').not.toBeNull();
    return {
      job: textOf(heading![1]),
      owner: owner === '—' ? null : owner,
      runs: Number(runs),
      retries: Number(retries.replace(/ retries$/, '')),
      lastStatus: result![1],
      lastError: error === '—' ? null : error,
      firstAt,
      lastAt,
      hadFail: result![2] !== undefined,
    };
  });
}

function markAsSymbolicLink<T extends { isFile(): boolean; isSymbolicLink(): boolean }>(entry: T): T {
  return Object.assign(entry, { isFile: () => false, isSymbolicLink: () => true });
}

describe('integrated digest routes', () => {
  beforeEach(() => {
    vi.stubEnv('LANE_ID', 'lane-test-digest');
    vi.stubEnv('LANE_MARKER', 'TEST-DIGEST-ROUTES');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T8 serves a regular log and rejects invalid IDs and a directory with a log name', async () => {
    await withDigestRunsDir(async (runsDir) => {
      await copySampleRun(runsDir, sampleNight);
      await writeFile(join(runsDir, wrongName + '.jsonl'), validLine + '\n');
      await mkdir(join(runsDir, directoryNight + '.jsonl'));
      const app = await appFor(runsDir);

      for (const prefix of prefixes) {
        expect((await app.request(prefix + '/' + sampleNight)).status).toBe(200);
        for (const night of [wrongName, sampleNight + '%2F' + sampleNight, directoryNight]) {
          expect((await app.request(prefix + '/' + night)).status, prefix + '/' + night).toBe(404);
        }
      }
    });
  });

  it('T8 skips a symbolic link before either route reads it and omits it from the board', async () => {
    await withDigestRunsDir(async (runsDir) => {
      const regularPath = await copySampleRun(runsDir, sampleNight);
      const linkPath = join(runsDir, linkNight + '.jsonl');
      await writeFile(linkPath, validLine + '\n');
      await mkdir(join(runsDir, directoryNight + '.jsonl'));
      expect(await readFile(linkPath, 'utf8')).toBe(validLine + '\n');

      const actual = await vi.importActual<FsModule & { default: FsModule }>('node:fs');
      const readdirSync = vi.fn(new Proxy(actual.readdirSync, {
        apply(operation, receiver, args): unknown {
          const entries: unknown = Reflect.apply(operation, receiver, args);
          if (args[0] !== runsDir || args[1]?.withFileTypes !== true) return entries;
          return (entries as Dirent[]).map((entry) =>
            entry.name === basename(linkPath) ? markAsSymbolicLink(entry) : entry,
          );
        },
      }));
      const lstatSync = vi.fn((path: PathLike, options: { bigint: true; throwIfNoEntry: false }) => {
        const entry = actual.lstatSync(path, options);
        return path === linkPath && entry ? markAsSymbolicLink(entry) : entry;
      });
      const openSync = vi.fn(actual.openSync);
      const readFileSync = vi.fn(actual.readFileSync);
      const overrides = { readdirSync, lstatSync, openSync, readFileSync };

      // Observe actual content reads by path or by the descriptor returned for this path.
      function readsOf(path: string) {
        const descriptors = openSync.mock.results.flatMap((result, index) =>
          result.type === 'return' && openSync.mock.calls[index][0] === path ? [result.value] : [],
        );
        return readFileSync.mock.calls.filter(([target]) =>
          target === path || (typeof target === 'number' && descriptors.includes(target)),
        );
      }

      vi.resetModules();
      vi.doMock('node:fs', () => ({ ...actual, ...overrides, default: { ...actual.default, ...overrides } }));
      try {
        const app = await appFor(runsDir);
        for (const prefix of prefixes) {
          openSync.mockClear();
          readFileSync.mockClear();
          lstatSync.mockClear();

          const normal = await app.request(prefix + '/' + sampleNight);
          expect(normal.status).toBe(200);
          expect(readsOf(regularPath).length, prefix + ' observes real file reads').toBeGreaterThan(0);

          openSync.mockClear();
          readFileSync.mockClear();
          lstatSync.mockClear();

          const blocked = await app.request(prefix + '/' + linkNight);
          expect(lstatSync.mock.calls.some(([path]) => path === linkPath), prefix + ' reached link metadata').toBe(true);
          expect(readsOf(linkPath), prefix + ' link content reads').toHaveLength(0);
          expect(blocked.status, prefix + ' link status').toBe(404);
          expect(await blocked.text()).not.toContain(fixtureJob);
        }

        const board = await app.request('/');
        expect(board.status).toBe(200);
        expect(readdirSync).toHaveBeenCalledWith(runsDir, expect.objectContaining({ withFileTypes: true }));
        const html = await board.text();
        expect(html).toContain('href="/digest/' + sampleNight + '"');
        expect(html).not.toContain('href="/digest/' + linkNight + '"');
        expect(html).not.toContain('href="/digest/' + directoryNight + '"');
        expect(html).not.toContain('[' + directoryNight + ']');
      } finally {
        vi.doUnmock('node:fs');
        vi.resetModules();
      }
    });
  });

  it('T10 renders all sample row fields consistently in HTML and JSON', async () => {
    await withDigestRunsDir(async (runsDir) => {
      await copySampleRun(runsDir, sampleNight);
      const result = await digestResponses(await appFor(runsDir), sampleNight);
      expect(result.pageStatus).toBe(200);
      expect(result.apiStatus).toBe(200);

      const rows = visibleDigestRows(result.html);
      expect(rows.map(({ job }) => job)).toEqual([
        'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
      ]);
      expect(rows[0]).toMatchObject({ owner: null, lastError: null });
      expect(rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
      expect(rows[3]).toMatchObject({ hadFail: true, lastError: 'quota exceeded' });
      expect(result.json).toStrictEqual({ rows, badLines: 1 });
      expect(result.html).toContain(warningMessage);
    });
  });

  const onlyValidRow = {
    job: fixtureJob, owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
    firstAt: fixtureTime, lastAt: fixtureTime, hadFail: false,
  } satisfies DigestRow;

  it.each([
    { name: 'empty', contents: '', rows: [], badLines: 0 },
    { name: 'partly malformed', contents: malformedLine + '\n' + validLine + '\n', rows: [onlyValidRow], badLines: 1 },
    { name: 'entirely malformed', contents: malformedLine + '\n', rows: [], badLines: 1 },
  ])('T11 handles the $name log in both formats', async ({ contents, rows, badLines }) => {
    await withDigestRunsDir(async (runsDir) => {
      await writeFile(join(runsDir, linkNight + '.jsonl'), contents);
      const result = await digestResponses(await appFor(runsDir), linkNight);

      expect(result.pageStatus).toBe(200);
      expect(result.apiStatus).toBe(200);
      expect(result.json).toStrictEqual({ rows, badLines });
      expect(visibleDigestRows(result.html)).toStrictEqual(rows);
      if (rows.length === 0) expect(result.html).toContain('nothing ran');
      else expect(result.html).not.toContain('nothing ran');
      if (badLines > 0) expect(result.html).toContain(warningMessage);
      else expect(result.html).not.toContain('malformed log');
    });
  });

  it('T11 renders a missing log as a 404 in both formats', async () => {
    await withDigestRunsDir(async (runsDir) => {
      await expectMissingNight(await appFor(runsDir), sampleNight);
    });
  });

  it('T11 renders a log removed after the board linked to it as a 404 in both formats', async () => {
    await withDigestRunsDir(async (runsDir) => {
      const log = await copySampleRun(runsDir, sampleNight);
      const app = await appFor(runsDir);
      const board = await app.request('/');
      expect(board.status).toBe(200);
      expect(await board.text()).toContain('href="/digest/' + sampleNight + '"');

      await unlink(log);

      await expectMissingNight(app, sampleNight);
    });
  });
});

