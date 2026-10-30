import { Cite } from './ui';

/** Renders numbered citation chips for a list of evidence ids, or an honest "no source" note. */
export function Cites({ ids, index, active, onPick }: { ids: string[]; index: Map<string, number>; active?: string | null; onPick: (id: string) => void }) {
  const known = ids.filter((i) => index.has(i));
  if (!known.length) return <span className="cite-none">no supporting source</span>;
  return <>{known.map((i) => <Cite key={i} n={index.get(i)!} active={active === i} onClick={() => onPick(i)} />)}</>;
}
