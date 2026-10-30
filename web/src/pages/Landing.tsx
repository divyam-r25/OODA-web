import { useTitle } from '../lib/hooks';
import { Link } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Mark } from '../ui/Icon';
import { Cite, KindBadge, LinkButton, SeverityGauge, Confidence } from '../ui/ui';

function LoopFigure() {
  const R = 118;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [200 + R * Math.cos(a), 200 + R * Math.sin(a)];
    const [x0, y0] = p(a0); const [x1, y1] = p(a1);
    return `M${x0!.toFixed(1)} ${y0!.toFixed(1)} A${R} ${R} 0 0 1 ${x1!.toFixed(1)} ${y1!.toFixed(1)}`;
  };
  const gap = 0.16;
  const q = Math.PI / 2;
  return (
    <svg className="loopfig" viewBox="0 0 400 400" role="img" aria-label="The OODA loop: Observe, Orient, Decide, Act, repeating">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1l7 4-7 4z" fill="var(--olive)" /></marker></defs>
      {[0, 1, 2, 3].map((i) => <path key={i} d={arc(-q + i * q + gap, -q + (i + 1) * q - gap)} fill="none" stroke="var(--olive)" strokeWidth="2.2" markerEnd="url(#ah)" />)}
      <circle cx="200" cy="200" r="74" fill="var(--sheet)" stroke="var(--line)" />
      <text x="200" y="196" textAnchor="middle" fontSize="30" fontWeight="600" fill="var(--ink)">OODA</text>
      <text x="200" y="220" textAnchor="middle" fontSize="13" fill="var(--ink-3)" style={{ fontFamily: 'var(--sans)' }}>repeat weekly</text>
      {[['Observe', 200, 44], ['Orient', 356, 206], ['Decide', 200, 372], ['Act', 44, 206]].map(([t, x, y]) => (
        <text key={String(t)} x={x as number} y={y as number} textAnchor="middle" fontSize="23" fontStyle="italic" fill="var(--ink)">{t}</text>
      ))}
    </svg>
  );
}

const LEDGER = [
  ['Observe', 'Step one', 'OODA visits the pages you choose, such as pricing, product and careers, on your schedule, politely and within each site’s robots.txt.', 'A dated snapshot of every page, kept so changes can be shown, not guessed.'],
  ['Orient', 'Step two', 'It compares today’s snapshot with the last one and reads what changed in the context of your company, audience and goal.', 'Signals with a severity, a confidence, and the exact lines that moved.'],
  ['Decide', 'Step three', 'Findings are written up as a short memo. Every statement is marked as a fact, an interpretation or a hypothesis.', 'A report you can reopen, compare across competitors, and export.'],
  ['Act', 'Step four', 'Turn a recommendation into a task with an owner and a due date, then watch it through to done.', 'An action list tied to the evidence that justified it.'],
];

export function Landing() {
  useTitle('');
  const { status } = useAuth();
  return (
    <div className="land">
      <header className="land-nav">
        <Link to="/" className="brand"><span style={{ background: 'var(--deep)', borderRadius: 8, display: 'grid', placeItems: 'center', width: 36, height: 36 }}><Mark size={26} /></span><b>OODA</b></Link>
        <nav aria-label="Site">
          <a href="#how" className="hide-sm">How it works</a><a href="#evidence" className="hide-sm">Evidence</a>
          {status === 'authed' ? <LinkButton to="/app" variant="primary" size="sm">Open workspace</LinkButton> : (<><Link to="/login">Sign in</Link><LinkButton to="/register" variant="primary" size="sm">Start free</LinkButton></>)}
        </nav>
      </header>
      <main>
        <section className="hero">
          <div>
            <h1>Know what your competitors changed, and <em>what to do about it.</em></h1>
            <p className="lead">OODA watches the public pages of the companies you compete with, shows you exactly what moved, and helps you decide. Every claim links back to the page it came from.</p>
            <div className="row"><LinkButton to="/register" variant="primary">Create a workspace</LinkButton><LinkButton to="/login">Sign in</LinkButton></div>
          </div>
          <LoopFigure />
        </section>

        <section className="band alt" id="how">
          <div className="wrap">
            <h2>One loop, run every week.</h2>
            <p className="intro">OODA is built around the decision cycle fighter pilots and founders both use: observe, orient, decide, act. The product follows it step for step.</p>
            <div className="ledger">
              {LEDGER.map(([verb, step, what, gets]) => (
                <div className="ledger-row" key={verb}>
                  <h3><small>{step}</small>{verb}</h3><p>{what}</p><p className="gets"><b>You get: </b>{gets}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band" id="evidence">
          <div className="wrap">
            <h2>Every claim carries its receipts.</h2>
            <p className="intro">Most AI summaries blur what a page says with what a model guesses. OODA keeps them apart, so you know how much weight each line can bear.</p>
            <div className="sheet sheet-pad example" aria-label="Illustrative example of a finding">
              <div className="row between wrap" style={{ marginBottom: 14 }}>
                <span className="tag">Illustrative example, not real data</span>
                <span className="row"><SeverityGauge level="high" /><Confidence value={0.8} /></span>
              </div>
              <div className="finding" style={{ borderTop: 0, paddingTop: 0 }}>
                <div className="meta"><KindBadge kind="fact" /><span className="small muted">pricing</span></div>
                <p className="serif" style={{ fontSize: 18 }}>The Team plan is listed at a higher monthly price than in the previous snapshot. <Cite n={1} /></p>
                <div className="quote">“Team plan now costs $129 per month.”</div>
              </div>
              <div className="finding"><div className="meta"><KindBadge kind="interpretation" /></div><p className="serif" style={{ fontSize: 18 }}>The increase narrows the gap to the Enterprise tier, which suggests a move up-market. <Cite n={1} /><Cite n={2} /></p></div>
              <div className="finding"><div className="meta"><KindBadge kind="hypothesis" /></div><p className="serif" style={{ fontSize: 18 }}>They may be preparing a new entry-level plan. <span className="cite-none">no supporting source</span></p></div>
              <div className="small muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <b style={{ color: 'var(--ink)' }}>Sources.</b> 1: example.com/pricing, collected 12 Mar. 2: example.com/enterprise, collected 12 Mar.
              </div>
            </div>
            <div className="legend" style={{ marginTop: 18 }}>
              <span><KindBadge kind="fact" /> stated in a source, with a quote we verified</span>
              <span><KindBadge kind="interpretation" /> inferred from cited sources</span>
              <span><KindBadge kind="hypothesis" /> plausible, not yet supported</span>
            </div>
          </div>
        </section>

        <section className="band alt">
          <div className="wrap">
            <h2>Honest by design.</h2>
            <div className="principles">
              <div><h3>Nothing is invented</h3><p>If a page could not be collected, the report says so. Quotes that are not in the source are downgraded automatically, and unmatched citations are removed.</p></div>
              <div><h3>History, not hunches</h3><p>Change detection compares stored snapshots line by line. A first run is labelled a baseline and never claims that something changed.</p></div>
              <div><h3>Polite collection</h3><p>OODA reads only public pages, respects robots.txt, identifies itself, and refuses private or internal network addresses.</p></div>
              <div><h3>Web text is untrusted</h3><p>Competitor pages are treated as data, never as instructions, so a hostile page cannot steer the analysis.</p></div>
            </div>
          </div>
        </section>
      </main>
      <footer className="land-foot"><div className="wrap row between wrap"><span>OODA · competitive intelligence for founders and product teams</span><Link to="/login">Sign in</Link></div></footer>
    </div>
  );
}
