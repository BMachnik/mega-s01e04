export type StatusKind = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: StatusKind;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  hadFail: boolean;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  counts: Record<StatusKind, number>;
};

/** Signature of the exported readNight(runsDir, night) function.
 * A missing night returns null. An existing empty log returns an empty digest.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
