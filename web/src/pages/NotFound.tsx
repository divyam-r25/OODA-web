import { LinkButton, EmptyState } from '../ui/ui';
import { useTitle } from '../lib/hooks';

export function NotFound({ standalone }: { standalone?: boolean }) {
  useTitle('Not found');
  const body = <EmptyState title="That page does not exist" action={<LinkButton to={standalone ? '/' : '/app'} variant="primary">{standalone ? 'Go to the homepage' : 'Back to the briefing'}</LinkButton>}>The address may be mistyped, or the page was moved.</EmptyState>;
  return standalone ? <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>{body}</div> : body;
}
