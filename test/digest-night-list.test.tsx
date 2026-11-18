import { describe, expect, it } from 'vitest';
import { buildNightSummaries } from '../src/digest/night-summaries.js';
import type { NightDigest, ReadNight } from '../src/digest/types.js';
import { NightList } from '../src/views/night-list.js';

const runsDir = 'stub-runs';
const latestNight = '2026-10-28';
const previousNight = '2026-10-27';
const emptyDigest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
const populatedDigest: NightDigest = {
  rows: [{
    job: 'digest/render',
    owner: null,
    runs: 4,
    retries: 1,
    lastStatus: 'ok',
    lastError: 'temporary error',
    firstAt: '2026-10-28T01:00:00Z',
    lastAt: '2026-10-28T02:00:00Z',
    hadFail: true,
  }],
  badLines: 0,
  counts: { ok: 2, retry: 1, fail: 1 },
};

function renderNights(nights: string[], readNight: ReadNight) {
  const summaries = buildNightSummaries(nights, runsDir, readNight);
  return (<NightList summaries={summaries} />).toString();
}

function nightRows(html: string) {
  const list = html.match(/<ul\b[^>]*\sclass="(?:[^"]* )?nights(?: [^"]*)?"[^>]*>(.*?)<\/ul>/s);
  expect(list).not.toBeNull();
  return Array.from(list?.[1].matchAll(/<li\b[^>]*>(.*?)<\/li>/gs) ?? [], ([, row]) => row);
}

function expectNightLink(row: string, night: string) {
  const link = row.match(/<a\b[^>]*\shref="([^"]+)"[^>]*>(.*?)<\/a>/s);
  expect(link?.[1]).toBe(`/digest/${night}`);
  expect(link?.[2]).toContain(night);
}

function expectCounts(row: string, counts: NightDigest['counts']) {
  const countSpan = row.match(/<span\b[^>]*\sclass="(?:[^"]* )?night-counts(?: [^"]*)?"[^>]*>(.*?)<\/span>/s);
  const countText = countSpan?.[1].replace(/<[^>]*>/g, '');
  expect(countText?.match(/\b(?:ok|retry|fail)\s+\d+\b/g)).toEqual([
    `ok ${counts.ok}`,
    `retry ${counts.retry}`,
    `fail ${counts.fail}`,
  ]);
}

describe('board night list (T9)', () => {
  it('shows the empty state without calling the reader', async () => {
    let reads = 0;
    const html = await renderNights([], () => {
      reads += 1;
      return emptyDigest;
    });

    expect(reads).toBe(0);
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });

  it('keeps the order of the listed nights and shows their labelled event counts', async () => {
    const calls: Array<[string, string]> = [];
    const html = await renderNights([latestNight, previousNight], (directory, night) => {
      calls.push([directory, night]);
      return night === latestNight ? populatedDigest : emptyDigest;
    });

    expect(calls).toEqual([[runsDir, latestNight], [runsDir, previousNight]]);
    const rows = nightRows(html);
    expect(rows).toHaveLength(2);
    expectNightLink(rows[0], latestNight);
    expectCounts(rows[0], populatedDigest.counts);
    expectNightLink(rows[1], previousNight);
    expectCounts(rows[1], emptyDigest.counts);
    expect(html).not.toContain('counts unavailable');
  });

  const unavailableReaders: Array<[string, ReadNight]> = [
    ['returns null after listing', () => null],
    ['throws an I/O error after listing', () => { throw new Error('simulated I/O error'); }],
  ];

  it.each(unavailableReaders)('shows counts unavailable when the reader %s', async (_reason, readNight) => {
    const html = await renderNights([latestNight, previousNight], (directory, night) => (
      night === latestNight ? readNight(directory, night) : emptyDigest
    ));

    const rows = nightRows(html);
    expect(rows).toHaveLength(2);
    expectNightLink(rows[0], latestNight);
    expect(rows[0]).toContain('counts unavailable');
    expect(rows[0]).not.toMatch(/\b(?:ok|retry|fail)\s+0\b/);
    expectNightLink(rows[1], previousNight);
    expectCounts(rows[1], emptyDigest.counts);
  });
});
