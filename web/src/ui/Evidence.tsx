import { dayOnly, host } from '../lib/format';
import type { Evidence } from '../lib/types';
import { Icon } from './Icon';

export function DiffView({ diff }: { diff: NonNullable<Evidence['diff']> }) {
  if (!diff.added.length && !diff.removed.length) return null;
  return (
    <div className="diff" role="group" aria-label="Lines that changed">
      {diff.removed.map((l, i) => <div key={'r' + i} className="del"><span className="sr-only">Removed: </span>− {l}</div>)}
      {diff.added.map((l, i) => <div key={'a' + i} className="add"><span className="sr-only">Added: </span>+ {l}</div>)}
      {(diff.addedCount > diff.added.length || diff.removedCount > diff.removed.length) && <div className="muted">… {diff.addedCount} lines added and {diff.removedCount} removed in total</div>}
    </div>
  );
}

export function EvidenceItem({ e, n, on, id }: { e: Evidence; n?: number; on?: boolean; id?: string }) {
  return (
    <div className={`src ${on ? 'on' : ''}`} id={id}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {n !== undefined && <span className="n">{n}</span>}
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{e.title || host(e.url)}</div>
          <a className="url" href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.url} <Icon name="external" size={12} /></a>
          <div className="small muted">Collected {dayOnly(e.fetchedAt)}{e.truncated ? ' · page truncated' : ''}</div>
        </div>
      </div>
      <p className="ex">{e.excerpt}</p>
      {e.diff && <DiffView diff={e.diff} />}
    </div>
  );
}
