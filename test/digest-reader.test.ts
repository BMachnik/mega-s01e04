import fs, { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadNight } from '../src/digest/types.js';

const night = '2026-10-28';
const sample = new URL(`../runs/${night}.jsonl`, import.meta.url);
const readerPath = '../src/digest/read-night.ts';
const event = { at: '2026-10-28T23:00:00Z', job: 'lane/sync', status: 'ok', owner: 'rook' };

async function loadReader(): Promise<ReadNight> {
  // Resolve the implementation at runtime so the tests can run on the contract-only checkout.
  const { readNight }: { readNight: ReadNight } = await import(readerPath);
  return readNight;
}

describe('readNight', () => {
  let runsDir: string;
  let logPath: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
    logPath = join(runsDir, `${night}.jsonl`);
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('T2 aggregates and sorts the jobs in the course sample', async () => {
    copyFileSync(sample, logPath);
    const readNight = await loadReader();

    const digest = readNight(runsDir, night);

    expect(digest?.rows.map(({ job }) => job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[0]).toMatchObject({ owner: null });
    expect(digest?.rows[1]).toMatchObject({
      runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
    });
    expect(digest?.rows[3]).toMatchObject({ hadFail: true, lastError: 'quota exceeded' });
  });

  it('T3 compares instants across offsets, breaks ties by file order and retains the latest error', async () => {
    const oldest = '2026-10-29T01:58:00+03:00';
    const latest = '2026-10-29T00:01:00+01:00';
    const events = [
      { ...event, at: '2026-10-28T23:01:00Z', status: 'retry' },
      { ...event, at: '2026-10-28T22:59:00Z', status: 'fail', error: 'lock lost' },
      { ...event, at: oldest, status: 'retry', error: 'older retry error' },
      { ...event, at: latest, owner: null },
    ];
    writeFileSync(logPath, events.map((entry) => JSON.stringify(entry)).join('\n'));
    const readNight = await loadReader();

    expect(readNight(runsDir, night)).toEqual({
      rows: [{
        job: event.job,
        owner: null,
        runs: 4,
        retries: 2,
        lastStatus: 'ok',
        lastError: 'lock lost',
        firstAt: oldest,
        lastAt: latest,
        hadFail: true,
      }],
      badLines: 0,
      counts: { ok: 1, retry: 2, fail: 1 },
    });
  });

  it('T4 counts each malformed line once and aggregates only valid events', async () => {
    const secondEvent = { ...event, job: 'rig/rotate-logs', status: 'retry', error: 'lock held' };
    const lines = [
      JSON.stringify(event),
      '{"at":',
      '42',
      JSON.stringify({ ...event, at: 'invalid timestamp' }),
      JSON.stringify({ ...event, job: 123 }),
      JSON.stringify({ ...event, status: 'pending' }),
      JSON.stringify({ ...event, owner: false }),
      JSON.stringify({ ...event, error: 503 }),
      '',
      JSON.stringify(secondEvent),
    ];
    writeFileSync(logPath, lines.join('\n'));
    const readNight = await loadReader();

    const digest = readNight(runsDir, night);

    expect(digest?.badLines).toBe(8);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest?.rows.map(({ job, runs, retries, lastError }) => ({ job, runs, retries, lastError })))
      .toEqual([
        { job: event.job, runs: 1, retries: 0, lastError: null },
        { job: secondEvent.job, runs: 1, retries: 1, lastError: secondEvent.error },
      ]);
  });

  it.each([{ name: 'LF', separator: '\n' }, { name: 'CRLF', separator: '\r\n' }])(
    'T4 ignores a final $name separator',
    async ({ separator }) => {
      writeFileSync(logPath, JSON.stringify(event) + separator);
      const readNight = await loadReader();

      const digest = readNight(runsDir, night);

      expect(digest?.rows.map(({ job }) => job)).toEqual([event.job]);
      expect(digest?.badLines).toBe(0);
      expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    },
  );

  it('T4 returns an empty digest for an empty file', async () => {
    writeFileSync(logPath, '');
    const readNight = await loadReader();

    expect(readNight(runsDir, night)).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('T4 returns null for a missing file', async () => {
    const readNight = await loadReader();

    expect(readNight(runsDir, night)).toBeNull();
  });

  it('T4 propagates the I/O error from reading an existing file', async () => {
    writeFileSync(logPath, JSON.stringify(event));
    const readNight = await loadReader();
    const readError = Object.assign(new Error('test read failed'), { code: 'EIO' });
    const read = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw readError; });

    let thrown: unknown;
    try {
      syncBuiltinESMExports();
      readNight(runsDir, night);
    } catch (error) {
      thrown = error;
    } finally {
      read.mockRestore();
      syncBuiltinESMExports();
    }

    expect(thrown).toBe(readError);
  });
});
