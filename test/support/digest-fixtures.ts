import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withDigestRunsDir<T>(use: (runsDir: string) => T | Promise<T>): Promise<T> {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
  try {
    return await use(runsDir);
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
}

export async function copySampleRun(runsDir: string, night: '2026-10-27' | '2026-10-28'): Promise<string> {
  const filename = `${night}.jsonl`;
  const source = new URL(`../../runs/${filename}`, import.meta.url);
  const destination = join(runsDir, filename);
  await copyFile(source, destination);
  return destination;
}
