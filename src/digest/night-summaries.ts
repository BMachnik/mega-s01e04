import type { NightDigest, ReadNight } from './types.js';

export type NightSummary = {
  night: string;
  counts: NightDigest['counts'] | null;
};

export function buildNightSummaries(
  nights: readonly string[],
  runsDir: string,
  readNight: ReadNight,
): NightSummary[] {
  return nights.map((night) => {
    try {
      return { night, counts: readNight(runsDir, night)?.counts ?? null };
    } catch {
      return { night, counts: null };
    }
  });
}
