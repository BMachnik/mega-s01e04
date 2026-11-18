import fs from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, StatusKind } from './types.js';

function readLog(path: string): string | null {
  const entry = fs.lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!entry?.isFile()) return null;

  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  let fd: number;
  try {
    fd = fs.openSync(path, O_RDONLY | (O_NOFOLLOW ?? 0) | (O_NONBLOCK ?? 0));
  } catch (error) {
    if (error instanceof Error && 'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ELOOP')) return null;
    throw error;
  }
  try {
    // Check the opened file before reading, even on platforms without O_NOFOLLOW.
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) return null;
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

type Instant = { seconds: number; fraction: string };

function compare(a: Instant, b: Instant): number {
  return a.seconds - b.seconds || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0);
}

function parseInstant(at: string): Instant | null {
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(at);
  if (!match) return null;
  const [, day, time, fraction = '', offset] = match;
  const calendarDay = new Date(day);
  if (!Number.isFinite(+calendarDay) || calendarDay.toISOString().slice(0, 10) !== day) return null;
  const seconds = Date.parse(`${day}T${time}${offset}`) / 1000;
  // Keep fractional seconds separately so precision finer than a millisecond survives.
  return Number.isFinite(seconds) ? { seconds, fraction: fraction.replace(/0+$/, '') } : null;
}

type RunEvent = {
  at: string;
  instant: Instant;
  job: string;
  status: StatusKind;
  owner: string | null;
  error?: string;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || !('at' in value) || typeof value.at !== 'string' ||
      !('job' in value) || typeof value.job !== 'string' || !value.job.trim() ||
      !('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail') ||
      !('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;

  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;

  const instant = parseInstant(value.at);
  if (instant === null) return null;
  return { at: value.at, instant, job: value.job, status: value.status, owner: value.owner, error };
}

type JobState = { row: DigestRow; first: Instant; last: Instant; lastError: Instant | null };

export const readNight: ReadNight = (runsDir, night) => {
  if (typeof night !== 'string' || night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const log = readLog(join(runsDir, `${night}.jsonl`));
  if (log === null) return null;

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, JobState>();
  const lines = log.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const event = parseEvent(line);
    if (!event) {
      digest.badLines++;
      continue;
    }
    digest.counts[event.status]++;
    let state = jobs.get(event.job);
    if (!state) {
      const row: DigestRow = {
        job: event.job, owner: event.owner, runs: 0, retries: 0, lastStatus: event.status,
        lastError: null, firstAt: event.at, lastAt: event.at, hadFail: false,
      };
      state = { row, first: event.instant, last: event.instant, lastError: null };
      jobs.set(event.job, state);
      digest.rows.push(row);
    }
    const { row } = state;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hadFail = true;
    if (compare(event.instant, state.first) < 0) {
      state.first = event.instant;
      row.firstAt = event.at;
    }
    if (compare(event.instant, state.last) >= 0) {
      state.last = event.instant;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && (state.lastError === null || compare(event.instant, state.lastError) >= 0)) {
      state.lastError = event.instant;
      row.lastError = event.error;
    }
  }
  digest.rows.sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
