import type { NightSummary } from '../digest/night-summaries.js';
import type { Status } from '../status.js';
import { NightList } from './night-list.js';

export function StatusBoard({ status, summaries }: { status: Status; summaries: readonly NightSummary[] }) {
  return (
    <>
      <h1>status</h1>
      <table>
        <tbody>
          <tr><th>adapter</th><td>{status.adapter}</td></tr>
          <tr><th>installed</th><td>{status.installed}</td></tr>
          <tr>
            <th>last beat</th>
            <td>{status.lastBeat ? `${status.lastBeat.at} · pid ${status.lastBeat.pid}` : <span class="warn">none</span>}</td>
          </tr>
        </tbody>
      </table>
      <h2>nights on disk</h2>
      <NightList summaries={summaries} />
    </>
  );
}
