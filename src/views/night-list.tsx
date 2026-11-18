import type { NightSummary } from '../digest/night-summaries.js';

export function NightList({ summaries }: { summaries: readonly NightSummary[] }) {
  if (summaries.length === 0) {
    return <p class="mute">nothing in runs/</p>;
  }

  return (
    <ul class="nights">
      {summaries.map(({ night, counts }) => (
        <li>
          <a href={`/digest/${encodeURIComponent(night)}`} aria-label={`Morning digest for ${night}`}>
            [{night}]
          </a>
          <span class="night-counts">
            {' · '}{counts ? `ok ${counts.ok} · retry ${counts.retry} · fail ${counts.fail}` : 'counts unavailable'}
          </span>
        </li>
      ))}
    </ul>
  );
}
