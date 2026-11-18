import type { NightDigest } from '../digest/types.js';

export function Digest({ title, digest }: { title: string; digest: NightDigest }) {
  const { rows, badLines } = digest;

  return (
    <>
      <h1>{title}</h1>
      {badLines > 0 && (
        <p class="warn">Skipped {badLines} malformed log {badLines === 1 ? 'line' : 'lines'}</p>
      )}
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <div class="digest-scroll" role="region" aria-label="Scrollable digest table" tabindex={0}>
          <table aria-label="Job results">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Owner</th>
                <th scope="col">Runs</th>
                <th scope="col">Retries</th>
                <th scope="col">Last status</th>
                <th scope="col">Last error</th>
                <th scope="col">First time</th>
                <th scope="col">Last time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.job}>
                  <th scope="row">{row.job}</th>
                  <td aria-label={row.owner === null ? 'Unknown owner' : undefined}>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries >= 3 ? <span class="warn">{row.retries} retries</span> : row.retries}</td>
                  <td>
                    {row.lastStatus}
                    {row.hadFail && <> · <span class="warn">fail observed</span></>}
                  </td>
                  <td>{row.lastError ?? '—'}</td>
                  <td><time datetime={row.firstAt}>{row.firstAt}</time></td>
                  <td><time datetime={row.lastAt}>{row.lastAt}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
