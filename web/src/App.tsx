import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, fmtAge, fmtPrice, provTitle, PROV_LABEL,
  type AlertItem, type CardDetail, type CardQuote, type FeedItem, type Mover, type PortfolioItem,
  type Provenance, type Snapshot, type SourceHealth, type SourceId, type Status,
} from './api';

type Zone = 'movers' | 'search' | 'feed';
type RightView = 'board' | 'search' | 'alerts' | 'portfolio';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [quotes, setQuotes] = useState<CardQuote[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [portfolio, setPortfolio] = useState<{ rows: PortfolioItem[]; totals: { value: number; cost: number; pnl: number } } | null>(null);
  const [rightView, setRightView] = useState<RightView>('board');
  const [searchLabel, setSearchLabel] = useState('');
  const [selCard, setSelCard] = useState<number | null>(null);
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [moverIdx, setMoverIdx] = useState(0);
  const [searchIdx, setSearchIdx] = useState(0);
  const [zone, setZone] = useState<Zone>('movers');
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "type HELP for commands · '/' focuses command line" });
  const [now, setNow] = useState(Date.now());
  const cmdRef = useRef<HTMLInputElement>(null);
  const rightViewRef = useRef<RightView>('board');
  rightViewRef.current = rightView;

  const refreshCore = useCallback(async () => {
    const [st, mv] = await Promise.all([api.status(), api.movers()]);
    setStatus(st);
    setMovers(mv.movers);
  }, []);
  const refreshFeed = useCallback(async () => setFeed((await api.feed()).items), []);
  const refreshAlerts = useCallback(async () => setAlerts((await api.alerts()).alerts), []);
  const refreshPortfolio = useCallback(async () => setPortfolio(await api.portfolio()), []);
  const refreshBoard = useCallback(async () => {
    if (rightViewRef.current !== 'board') return;
    const r = await api.board();
    if (rightViewRef.current === 'board') setQuotes(r.quotes);
  }, []);

  useEffect(() => {
    void refreshCore();
    void refreshFeed();
    void refreshBoard();
    void refreshAlerts();
    const es = new EventSource('/api/stream');
    es.addEventListener('cycle', () => {
      void refreshCore(); void refreshFeed(); void refreshBoard();
      if (rightViewRef.current === 'portfolio') void refreshPortfolio();
    });
    es.addEventListener('feed', () => void refreshFeed());
    es.addEventListener('health', () => void refreshCore());
    es.addEventListener('alert', () => {
      void refreshAlerts();
      setMsg({ text: '⚠ ALERT TRIGGERED — type AL to view', err: false });
    });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { es.close(); clearInterval(clock); };
  }, [refreshCore, refreshFeed, refreshBoard, refreshAlerts, refreshPortfolio]);

  useEffect(() => {
    if (selCard == null) return setDetail(null);
    let dead = false;
    const load = () => api.card(selCard).then((d) => { if (!dead) setDetail(d); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { dead = true; clearInterval(t); };
  }, [selCard, status?.cycleCount]);

  useEffect(() => {
    if (zone === 'movers' && movers[moverIdx]) setSelCard(movers[moverIdx].cardId);
  }, [movers, moverIdx, zone]);

  const runCommand = useCallback(async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    const c = cmd.toLowerCase();
    const rowCard = (n: string): number | null =>
      quotes[Number(n) - 1]?.card.id ?? movers[Number(n) - 1]?.cardId ?? selCard;
    try {
      if (c === 'help' || c === '?') {
        setMsg({ text: 'S <cards> · W <row> · ALERT <row> ABOVE|BELOW <px> · PF ADD <row> <qty> <cost> · AL/PF/BD views · K/R <src> · INJECT <row> JUMP|VOL' });
      } else if (c === 's' || c === 'search') {
        const r = await api.search(arg);
        setQuotes(r.quotes); setSearchLabel(arg); setSearchIdx(0); setZone('search'); setRightView('search');
        if (r.quotes[0]) setSelCard(r.quotes[0].card.id);
        setMsg({ text: `${r.quotes.length} result(s) for "${arg}"` });
      } else if (c === 'bd' || c === 'board') {
        setRightView('board'); setSearchLabel('');
        const r = await api.board(); setQuotes(r.quotes);
      } else if (c === 'al' || c === 'alerts') {
        setRightView('alerts'); await refreshAlerts();
      } else if (c === 'pf' || c === 'portfolio') {
        if (/^add\b/i.test(arg)) {
          const [, rowS, qtyS, costS] = arg.split(/\s+/);
          const id = rowCard(rowS);
          if (id == null || !(Number(qtyS) > 0)) throw new Error('usage: PF ADD <row> <qty> <cost>');
          await api.addPortfolio(id, Number(qtyS), Number(costS ?? 0));
          setMsg({ text: `portfolio: card #${id} × ${qtyS} @ ${costS ?? 0}` });
        } else if (/^rm\b/i.test(arg)) {
          const [, rowS] = arg.split(/\s+/);
          const id = portfolio?.rows[Number(rowS) - 1]?.cardId ?? rowCard(rowS);
          if (id == null) throw new Error('usage: PF RM <row>');
          await api.removePortfolio(id);
        }
        setRightView('portfolio'); await refreshPortfolio();
      } else if (c === 'alert') {
        const [rowS, dirS, pxS] = rest;
        if (/^rm$/i.test(rowS ?? '')) {
          const a = alerts[Number(dirS) - 1];
          if (!a) throw new Error('usage: ALERT RM <row-in-AL-view>');
          await api.removeAlert(a.id); await refreshAlerts();
          setMsg({ text: `alert #${a.id} removed` });
          return;
        }
        const id = rowCard(rowS);
        const dir = /^ab/i.test(dirS ?? '') ? 'above' : /^be/i.test(dirS ?? '') ? 'below' : null;
        const px = Number(pxS);
        if (id == null || !dir || !(px > 0)) throw new Error('usage: ALERT <row> ABOVE|BELOW <price>  (or ALERT RM <row>)');
        await api.addAlert(id, dir, px);
        await refreshAlerts();
        setMsg({ text: `armed: card #${id} ${dir} ${px} (best px basis)` });
      } else if (c === 'w' || c === 'watch') {
        const id = rowCard(arg);
        if (id == null) throw new Error('no row selected');
        await api.watch(id); setMsg({ text: `watching card #${id}` });
      } else if (c === 'uw' || c === 'unwatch') {
        const id = rowCard(arg);
        if (id == null) throw new Error('no row selected');
        await api.unwatch(id); setMsg({ text: `unwatched card #${id}` });
      } else if (c === 'o' || c === 'open') {
        const q = quotes[Number(arg) - 1];
        if (!q) throw new Error(`no search row ${arg}`);
        setSelCard(q.card.id); setSearchIdx(Number(arg) - 1);
      } else if (c === 'k' || c === 'kill' || c === 'r' || c === 'restore') {
        const src = normSource(arg);
        if (!src) throw new Error('usage: K tcg|ebay|feed');
        await api.kill(src, c === 'k' || c === 'kill');
        setMsg({ text: `${src} ${c.startsWith('k') ? 'KILLED (drill)' : 'restored'}` });
        void refreshCore();
      } else if (c === 'inject') {
        const [rowS, kindS, pctS] = rest;
        const target = rowCard(rowS);
        if (target == null) throw new Error('usage: INJECT <row> JUMP|VOL [pct]');
        const kind = /vol/i.test(kindS ?? '') ? 'volume_spike' : 'price_jump';
        await api.inject(target, kind, pctS ? Number(pctS) : undefined);
        setMsg({ text: `SYNTHETIC ${kind} injected on card #${target} — watch MOVERS` });
      } else if (c === 'mv' || c === 'movers') { setZone('movers');
      } else if (c === 'fd' || c === 'feed') { setZone('feed');
      } else {
        const r = await api.search(line);
        setQuotes(r.quotes); setSearchLabel(line); setSearchIdx(0); setZone('search'); setRightView('search');
        if (r.quotes[0]) setSelCard(r.quotes[0].card.id);
        setMsg({ text: `${r.quotes.length} result(s) for "${line}"` });
      }
    } catch (err: any) {
      setMsg({ text: String(err?.message ?? err).slice(0, 130), err: true });
    }
  }, [quotes, movers, selCard, alerts, portfolio, refreshCore, refreshAlerts, refreshPortfolio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target === cmdRef.current) {
        if (e.key === 'Escape') cmdRef.current?.blur();
        return;
      }
      if (e.key === '/') { e.preventDefault(); cmdRef.current?.focus(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        setZone((z) => (z === 'movers' ? 'search' : z === 'search' ? 'feed' : 'movers'));
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        if (zone === 'movers') setMoverIdx((i) => clamp(i + d, 0, Math.max(0, movers.length - 1)));
        if (zone === 'search') setSearchIdx((i) => {
          const n = clamp(i + d, 0, Math.max(0, quotes.length - 1));
          if (quotes[n]) setSelCard(quotes[n].card.id);
          return n;
        });
      }
      if (e.key === 'Enter') {
        if (zone === 'movers' && movers[moverIdx]) setSelCard(movers[moverIdx].cardId);
        if (zone === 'search' && quotes[searchIdx]) setSelCard(quotes[searchIdx].card.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zone, movers, moverIdx, quotes, searchIdx]);

  const isSample = status?.mode === 'sample';
  const armedAlerts = alerts.filter((a) => !a.triggeredTs).length;
  const firedAlerts = alerts.filter((a) => a.triggeredTs).length;

  return (
    <div className="term">
      <TopBar status={status} now={now} armed={armedAlerts} fired={firedAlerts} />
      <div className="main">
        <div className={`panel ${zone === 'movers' ? 'focused' : ''}`}>
          {isSample && <div className="banner-sample">Sample data — simulated market · no real prices on screen</div>}
          <div className="panel-title">Movers — early signal <span className="cnt">{movers.length}</span>
            <span className="hint">↑↓ select · ⏎ detail · score = |Δ24h| + activity σ + spread</span>
          </div>
          <div className="panel-body">
            <MoversTable movers={movers} sel={zone === 'movers' ? moverIdx : -1} now={now}
              onPick={(i) => { setZone('movers'); setMoverIdx(i); setSelCard(movers[i].cardId); }} />
          </div>
          {movers[moverIdx] && zone === 'movers' && <WhyLine mover={movers[moverIdx]} now={now} />}
        </div>

        <div className={`panel ${zone === 'search' ? 'focused' : ''}`}>
          <div className="panel-title">
            {rightView === 'board' && <>Board — top value <span className="cnt">{quotes.length}</span></>}
            {rightView === 'search' && <>Search <span className="cnt">“{truncate(searchLabel, 40)}”</span></>}
            {rightView === 'alerts' && <>Alerts <span className="cnt">{armedAlerts} armed · {firedAlerts} fired</span></>}
            {rightView === 'portfolio' && <>Portfolio <span className="cnt">{portfolio?.rows.length ?? 0} positions</span></>}
            <span className="hint">S search · BD board · AL alerts · PF portfolio</span>
          </div>
          <div className="panel-body">
            {(rightView === 'board' || rightView === 'search') && (
              <SearchTable quotes={quotes} sel={zone === 'search' ? searchIdx : -1} now={now}
                onPick={(i) => { setZone('search'); setSearchIdx(i); setSelCard(quotes[i].card.id); }} />
            )}
            {rightView === 'alerts' && <AlertsTable alerts={alerts} now={now} onPick={(id) => setSelCard(id)} />}
            {rightView === 'portfolio' && <PortfolioTable pf={portfolio} now={now} onPick={(id) => setSelCard(id)} />}
          </div>
          {rightView === 'portfolio' && portfolio && (
            <div className="totalsline">
              <span>VALUE <b>{fmtPrice(portfolio.totals.value)}</b></span>
              <span>COST <b>{fmtPrice(portfolio.totals.cost)}</b></span>
              <span>P/L <b className={portfolio.totals.pnl >= 0 ? 'up' : 'down'}>{portfolio.totals.pnl >= 0 ? '+' : ''}{fmtPrice(portfolio.totals.pnl)}</b></span>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Card detail {detail && <span className="cnt">#{detail.quote.card.id}</span>}
            <span className="hint">ALERT &lt;row&gt; ABOVE|BELOW &lt;px&gt; · PF ADD &lt;row&gt; &lt;qty&gt; &lt;cost&gt;</span>
          </div>
          <DetailPanel detail={detail} now={now} movers={movers} />
        </div>

        <div className={`panel ${zone === 'feed' ? 'focused' : ''}`}>
          <div className="panel-title">Wire — X feed <span className="cnt">{feed.length}</span>
            <span className="hint">{(status?.sources.find((s) => s.source === 'feed')?.state ?? '').toUpperCase()}</span>
          </div>
          <div className="panel-body">
            {feed.length === 0 && <div className="empty">no feed items — source {status?.sources.find((s) => s.source === 'feed')?.state}</div>}
            {feed.map((f) => <FeedRow key={f.id} f={f} now={now} />)}
          </div>
        </div>
      </div>

      <CommandLine onRun={runCommand} msg={msg} inputRef={cmdRef} />
      <StatusBar status={status} now={now} />
    </div>
  );
}

/* ---------------- top bar / status ---------------- */

function TopBar({ status, now, armed, fired }: { status: Status | null; now: number; armed: number; fired: number }) {
  const countdown = status ? Math.max(0, Math.ceil((status.nextCycleTs - now) / 1000)) : null;
  const overall = status?.overall ?? 'down';
  return (
    <div className="topbar">
      <span className="brand">RBT<span className="blk">▮</span> Riftbound Terminal</span>
      <span className={`mode-badge ${overall}`}>{status ? overall.toUpperCase() : '·····'}</span>
      <span className="kv">MKTS <b>TCGPLAYER · EBAY</b></span>
      <span className="sep">│</span>
      <span className="kv">CARDS <b>{status?.cards ?? '—'}</b></span>
      <span className="sep">│</span>
      <span className="kv">ALERTS <b>{armed}</b>{fired > 0 && <b className="warn"> ·{fired}!</b>}</span>
      <span className="sep">│</span>
      <span className="kv">CYCLE <b>#{status?.cycleCount ?? '—'}</b> NEXT <b>{countdown != null ? `${countdown}s` : '—'}</b></span>
      <span className="spring" />
      <span className="clock">{new Date(now).toISOString().slice(0, 19).replace('T', ' ')} UTC</span>
    </div>
  );
}

function Prov({ p, source, ts, now }: { p: Provenance | null; source: string; ts: number | null; now: number }) {
  if (!p) return null;
  return <span className={`prov ${p}`} title={provTitle(p, source, ts, now)}>{PROV_LABEL[p]}</span>;
}

/* ---------------- movers ---------------- */

function MoversTable({ movers, sel, now, onPick }: {
  movers: Mover[]; sel: number; now: number; onPick: (i: number) => void;
}) {
  if (!movers.length) return <div className="empty">no movers above threshold — market is quiet</div>;
  const maxScore = Math.max(...movers.map((m) => m.score), 1);
  return (
    <table>
      <thead>
        <tr>
          <th className="l">#</th><th className="l">CARD</th><th className="l">SET/NO</th>
          <th>Δ24H</th><th>ACTσ</th><th>SPRD</th><th>TCG</th><th>EBAY</th><th className="l">SCORE</th>
        </tr>
      </thead>
      <tbody>
        {movers.map((m, i) => {
          const tcg = m.latest.find((l) => l.source === 'tcgplayer');
          const eb = m.latest.find((l) => l.source === 'ebay');
          return (
            <tr key={m.cardId} className={`row ${i === sel ? 'sel' : ''}`} onClick={() => onPick(i)}>
              <td className="l rankcell">{i + 1}</td>
              <td className="l">{m.card.name}</td>
              <td className="l dim">{m.card.setName}{m.card.number ? ` ${m.card.number}` : ''}</td>
              <td className={m.pct24h == null ? 'dim' : m.pct24h >= 0 ? 'up' : 'down'}>
                {m.pct24h == null ? '—' : `${m.pct24h >= 0 ? '▲ +' : '▼ '}${m.pct24h.toFixed(1)}%`}
              </td>
              <td className={m.volumeZ != null && m.volumeZ >= 1.5 ? 'warn' : 'dim'}>
                {m.volumeZ == null ? '—' : `${m.volumeZ.toFixed(1)}σ`}
              </td>
              <td className={m.spreadPct != null && m.spreadPct >= 4 ? 'cyan' : 'dim'}>
                {m.spreadPct == null ? '—' : `${m.spreadPct.toFixed(0)}%`}
              </td>
              <td>{tcg ? <>{fmtPrice(tcg.price)}<Prov p={tcg.provenance} source="TCGplayer" ts={tcg.ts} now={now} /></> : <span className="faint">—</span>}</td>
              <td>{eb ? <>{fmtPrice(eb.price)}<Prov p={eb.provenance} source="eBay" ts={eb.ts} now={now} /></> : <span className="faint">—</span>}</td>
              <td className="l"><span className="scorebar" style={{ width: `${Math.max(4, (m.score / maxScore) * 52)}px` }} /> <span className="dim">{m.score.toFixed(1)}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WhyLine({ mover, now }: { mover: Mover; now: number }) {
  return (
    <div className="why">
      <div className="headline">▸ {mover.why.headline}</div>
      <div className="factors dim">
        {mover.why.factors.join(' · ')}
        {mover.why.feedRefs.map((r, i) => (
          <span key={i}> · <span className="fref">@{r.account}</span> <span className="faint">({fmtAge(r.ts, now)} ago):</span> “{truncate(r.text, 90)}”</span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- right panel views ---------------- */

function SearchTable({ quotes, sel, now, onPick }: {
  quotes: CardQuote[]; sel: number; now: number; onPick: (i: number) => void;
}) {
  if (!quotes.length) return <div className="empty">S &lt;card name&gt; — e.g. <kbd>s jinx</kbd> or <kbd>s teemo promo, ahri overnumbered</kbd></div>;
  return (
    <table>
      <thead>
        <tr>
          <th className="l">#</th><th className="l">CARD</th><th>AVG</th><th>BEST</th><th className="l">VENUE</th><th>AGE</th>
        </tr>
      </thead>
      <tbody>
        {quotes.map((q, i) => (
          <tr key={q.card.id} className={`row ${i === sel ? 'sel' : ''}`} onClick={() => onPick(i)}>
            <td className="l rankcell">{i + 1}</td>
            <td className="l" title={`${q.card.setName} · ${q.card.rarity ?? ''} · ${q.card.kind}`}>{q.card.name}</td>
            <td title="mean of per-source market prices">{fmtPrice(q.blendedAvg)}</td>
            <td>
              {q.best ? <>
                <span className="up">{fmtPrice(q.best.price)}</span>
                <Prov p={q.best.provenance} source={q.best.source} ts={q.best.ts} now={now} />
              </> : <span className="faint">—</span>}
            </td>
            <td className="l cyan">{q.best ? q.best.source.toUpperCase() : '—'}</td>
            <td className="dim">{q.best ? fmtAge(q.best.ts, now) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlertsTable({ alerts, now, onPick }: { alerts: AlertItem[]; now: number; onPick: (cardId: number) => void }) {
  if (!alerts.length) return <div className="empty">no alerts — <kbd>ALERT &lt;row&gt; ABOVE|BELOW &lt;price&gt;</kbd> arms one on the best cross-venue price</div>;
  return (
    <table>
      <thead>
        <tr><th className="l">#</th><th className="l">CARD</th><th className="l">COND</th><th>PX</th><th className="l">STATUS</th></tr>
      </thead>
      <tbody>
        {alerts.map((a, i) => (
          <tr key={a.id} className="row" onClick={() => a.card && onPick(a.card.id)}>
            <td className="l rankcell">{i + 1}</td>
            <td className="l">{a.card?.name ?? `#${a.cardId}`}</td>
            <td className="l dim">{a.direction === 'above' ? '≥' : '≤'} {fmtPrice(a.threshold)} ({a.basis})</td>
            <td>{a.triggeredPrice != null ? fmtPrice(a.triggeredPrice) : '—'}</td>
            <td className="l">
              {a.triggeredTs
                ? <span className="warn">FIRED {fmtAge(a.triggeredTs, now)} ago</span>
                : <span className="mint">ARMED</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PortfolioTable({ pf, now, onPick }: {
  pf: { rows: PortfolioItem[]; totals: { value: number; cost: number; pnl: number } } | null;
  now: number;
  onPick: (cardId: number) => void;
}) {
  if (!pf || !pf.rows.length) return <div className="empty">empty portfolio — <kbd>PF ADD &lt;row&gt; &lt;qty&gt; &lt;cost-each&gt;</kbd></div>;
  return (
    <table>
      <thead>
        <tr><th className="l">#</th><th className="l">CARD</th><th>QTY</th><th>COST</th><th>MARK</th><th>P/L</th><th>P/L%</th></tr>
      </thead>
      <tbody>
        {pf.rows.map((r, i) => (
          <tr key={r.cardId} className="row" onClick={() => r.card && onPick(r.card.id)}>
            <td className="l rankcell">{i + 1}</td>
            <td className="l">{r.card?.name ?? `#${r.cardId}`}</td>
            <td>{r.qty}</td>
            <td className="dim">{fmtPrice(r.costBasis)}</td>
            <td>{fmtPrice(r.mark)}{r.provenance && <Prov p={r.provenance} source="blend" ts={null} now={now} />}</td>
            <td className={r.pnl == null ? 'dim' : r.pnl >= 0 ? 'up' : 'down'}>{r.pnl == null ? '—' : `${r.pnl >= 0 ? '+' : ''}${fmtPrice(r.pnl)}`}</td>
            <td className={r.pnlPct == null ? 'dim' : r.pnlPct >= 0 ? 'up' : 'down'}>{r.pnlPct == null ? '—' : `${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- card detail (Rexa-style) ---------------- */

function DetailPanel({ detail, now, movers }: { detail: CardDetail | null; now: number; movers: Mover[] }) {
  if (!detail) return <div className="empty">select a mover or search result — ⏎ opens it here</div>;
  const { quote, stats, graded, raw, links, history } = detail;
  const mover = movers.find((m) => m.cardId === quote.card.id);
  const fresh = quote.perSource.filter((p) => p.avgPrice != null && (p.provenance === 'live' || p.provenance === 'sample' || p.provenance === 'synthetic'));
  const anyData = quote.perSource.filter((p) => p.avgPrice != null);
  const conf = fresh.length >= 2
    ? { cls: 'conf-high', label: `HIGH · ${fresh.length} SOURCES` }
    : fresh.length === 1
      ? { cls: 'conf-med', label: 'MED · 1 SOURCE' }
      : anyData.length
        ? { cls: 'conf-low', label: 'LOW · AGED DATA' }
        : { cls: 'conf-low', label: 'NO DATA' };

  return (
    <div className="detail-scroll">
      <div className="detail-head">
        <span className="detail-name">{quote.card.name}</span>
        <span className="chip kind">{quote.card.kind}</span>
        {quote.card.rarity && <span className="chip kind">{quote.card.rarity}</span>}
        <span className="detail-sub">{quote.card.setName}{quote.card.number ? ` · ${quote.card.number}` : ''}</span>
        <span className="detail-actions">
          <a className="btn" href={links.ebay} target="_blank" rel="noreferrer">eBay →</a>
          <a className="btn" href={links.tcgplayer} target="_blank" rel="noreferrer">TCGplayer →</a>
        </span>
      </div>

      <div className="statstrip">
        <StatCell k="7D change" v={stats.d7Pct} pct />
        <StatCell k="30D change" v={stats.d30Pct} pct />
        <div className="stat"><div className="k">Liquidity</div><div className="v">{stats.liquidity || '—'}<span className="faint" style={{ fontSize: 10 }}> listings</span></div></div>
        <div className="stat"><div className="k">Volume 7D</div><div className="v">{stats.vol7 || '—'}</div></div>
      </div>

      <div className="detail-cols">
        <div>
          <div className="card-sec">
            <div className="sec-label">Fair market value</div>
            <div className="fmv-row">
              <span className="fmv">{quote.blendedAvg != null ? `$${fmtPrice(quote.blendedAvg)}` : '—'}</span>
              <span className={`chip ${conf.cls}`}>{conf.label}</span>
            </div>
            <div className="sec-label" style={{ marginTop: 6 }}>Multi-source pricing</div>
            {quote.perSource.map((p) => (
              <div className="srcline" key={p.source}>
                <span className="venue">{p.source.toUpperCase()}</span>
                <span className="meta">{p.listingCount != null ? `${p.listingCount} lstg` : ''} {p.state !== 'live' && p.state !== 'sample' ? p.state.toUpperCase() : ''}</span>
                <span className="px">
                  {fmtPrice(p.avgPrice)} <span className="faint">avg</span> · <span className={quote.best?.source === p.source ? 'up' : ''}>{fmtPrice(p.bestPrice)}</span> <span className="faint">best</span>
                  <Prov p={p.provenance} source={p.source} ts={p.ts} now={now} />
                </span>
              </div>
            ))}
          </div>

          <GradingRoi quote={quote} graded={graded} raw={raw} now={now} />

          {mover && (
            <div className="card-sec">
              <div className="sec-label">Signal read</div>
              <div>{mover.why.headline}</div>
              <div className="dim" style={{ fontSize: 11 }}>{mover.why.factors.join(' · ')}</div>
            </div>
          )}
        </div>

        <div>
          <div className="card-sec">
            <div className="sec-label">Price history — 14d <span className="mint">▬ TCG</span> <span className="cyan">▬ EBAY</span></div>
            <Sparkline tcg={history.tcgplayer} ebay={history.ebay} />
            <HistoryStats history={history} />
          </div>
          <PricesByGrade card={quote} graded={graded} raw={raw} now={now} />
        </div>
      </div>
    </div>
  );
}

function StatCell({ k, v, pct }: { k: string; v: number | null; pct?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v ${v == null ? 'faint' : v >= 0 ? 'up' : 'down'}`}>
        {v == null ? '—' : `${v >= 0 ? '▲ +' : '▼ '}${v.toFixed(1)}${pct ? '%' : ''}`}
      </div>
    </div>
  );
}

/** Grading ROI — generalized: expected-graded value comes from the top graded
 *  variant of this card found in the catalog; the miss-case falls back to the
 *  next grade down (or the raw price). User controls gem odds and fee. */
function GradingRoi({ quote, graded, raw, now }: {
  quote: CardQuote;
  graded: CardDetail['graded'];
  raw: CardDetail['raw'];
  now: number;
}) {
  const [odds, setOdds] = useState(70);
  const [fee, setFee] = useState(25);

  if (quote.card.kind === 'slab') {
    if (!raw) return null;
    return (
      <div className="card-sec">
        <div className="sec-label">Raw counterpart</div>
        <div className="srcline">
          <span>{raw.card.name}</span>
          <span className="px">{fmtPrice(raw.quote.blendedAvg)} <span className="faint">avg</span>
            {raw.quote.perSource[0]?.provenance && <Prov p={raw.quote.perSource[0].provenance} source="blend" ts={raw.quote.perSource[0].ts} now={now} />}
          </span>
        </div>
      </div>
    );
  }

  const sorted = [...graded]
    .filter((g) => g.quote.blendedAvg != null)
    .sort((a, b) => (b.quote.blendedAvg ?? 0) - (a.quote.blendedAvg ?? 0));
  const rawPx = quote.blendedAvg;
  if (!sorted.length || rawPx == null) return null;

  const top = sorted[0];
  const alt = sorted[1]?.quote.blendedAvg ?? rawPx;
  const topPx = top.quote.blendedAvg as number;
  const p = odds / 100;
  const ev = p * topPx + (1 - p) * alt;
  const net = ev - fee - rawPx;
  const roiPct = (net / (rawPx + fee)) * 100;
  const breakEven = topPx !== alt ? Math.max(0, Math.min(100, ((rawPx + fee - alt) / (topPx - alt)) * 100)) : null;
  const worth = net > 0;

  return (
    <div className="card-sec">
      <div className="sec-label">Grading ROI</div>
      <div className="fmv-row">
        <span className={`chip ${worth ? 'verdict-yes' : 'verdict-no'}`}>{worth ? 'Worth grading' : 'Not worth grading'}</span>
        <span className={`roi-net ${worth ? 'up' : 'down'}`} style={{ marginLeft: 'auto' }}>
          {net >= 0 ? '▲ +' : '▼ '}${fmtPrice(Math.abs(net))}
        </span>
      </div>
      <div className="roi-sub">net after fee · {roiPct >= 0 ? '+' : ''}{roiPct.toFixed(0)}% ROI</div>
      <div className="roi-grid">
        <div><div className="k">Raw now</div><div className="v">${fmtPrice(rawPx)}</div></div>
        <div><div className="k">Exp. {top.grade ? `${top.grade.company} ${top.grade.grade}` : 'graded'}</div><div className="v">${fmtPrice(topPx)}</div></div>
        <div><div className="k">Grade fee</div><div className="v">${fee}</div></div>
      </div>
      <div className="roi-ctl">
        <span>{top.grade ? `${top.grade.company} ${top.grade.grade}` : 'top grade'} likelihood</span>
        <input type="range" min={0} max={100} value={odds} onChange={(e) => setOdds(Number(e.target.value))} />
        <span className="num" style={{ width: 34, textAlign: 'right' }}>{odds}%</span>
      </div>
      <div className="roi-ctl">
        <span>grading fee</span>
        <input type="number" min={0} value={fee} onChange={(e) => setFee(Math.max(0, Number(e.target.value)))} />
      </div>
      <div className="roi-note">
        {breakEven != null && <>breaks even at <b>{breakEven.toFixed(0)}%</b> odds · </>}
        miss-case assumes {sorted[1]?.grade ? `${sorted[1].grade.company} ${sorted[1].grade.grade}` : 'raw value'} · odds are your call — no population data yet
      </div>
    </div>
  );
}

function PricesByGrade({ card, graded, raw, now }: {
  card: CardQuote;
  graded: CardDetail['graded'];
  raw: CardDetail['raw'];
  now: number;
}) {
  const rows: { chip: string; quote: CardQuote }[] = [];
  if (card.card.kind === 'slab') {
    const g = /(PSA|BGS|CGC|SGC)\s*(10|[1-9](?:\.5)?)/i.exec(card.card.name);
    rows.push({ chip: g ? `${g[1].toUpperCase()} ${g[2]}` : 'GRADED', quote: card });
    if (raw) rows.push({ chip: 'RAW', quote: raw.quote });
  } else {
    for (const g of graded) rows.push({ chip: g.grade ? `${g.grade.company} ${g.grade.grade}` : 'GRADED', quote: g.quote });
    rows.push({ chip: 'RAW', quote: card });
  }
  if (rows.length <= 1) return null;
  return (
    <div className="card-sec">
      <div className="sec-label">Prices by grade</div>
      {rows.map((r, i) => {
        const ps = r.quote.perSource.find((p) => p.avgPrice != null);
        return (
          <div className="gradeline" key={i}>
            <span className={`chip ${r.chip === 'RAW' ? 'kind' : 'grade'}`}>{r.chip}</span>
            <span className="asof">{ps?.ts ? `as of ${fmtAge(ps.ts, now)} ago` : ''}</span>
            <span className="px">{r.quote.blendedAvg != null ? `$${fmtPrice(r.quote.blendedAvg)}` : '—'}
              {ps?.provenance && <Prov p={ps.provenance} source={ps.source} ts={ps.ts} now={now} />}
            </span>
          </div>
        );
      })}
      <div className="roi-note">graded values are market averages of matching slabs in the catalog</div>
    </div>
  );
}

/* ---------------- chart ---------------- */

function Sparkline({ tcg, ebay }: { tcg: Snapshot[]; ebay: Snapshot[] }) {
  const W = 250, H = 90;
  const all = [...tcg, ...ebay].filter((s) => s.marketPrice != null);
  if (all.length < 2) return <div className="empty">not enough history</div>;
  const t0 = Math.min(...all.map((s) => s.ts));
  const t1 = Math.max(...all.map((s) => s.ts));
  const p0 = Math.min(...all.map((s) => s.marketPrice as number));
  const p1 = Math.max(...all.map((s) => s.marketPrice as number));
  const px = (ts: number) => ((ts - t0) / Math.max(1, t1 - t0)) * (W - 4) + 2;
  const py = (p: number) => H - 6 - ((p - p0) / Math.max(0.0001, p1 - p0)) * (H - 20);
  const path = (arr: Snapshot[]) =>
    arr.filter((s) => s.marketPrice != null).map((s, i) => `${i ? 'L' : 'M'}${px(s.ts).toFixed(1)},${py(s.marketPrice as number).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
      <rect x="0" y="0" width={W} height={H} fill="#0a0d0c" stroke="#1d2422" rx="6" />
      <text x="4" y="12" fill="#59635f" fontSize="9" fontFamily="monospace">{fmtPrice(p1)}</text>
      <text x="4" y={H - 4} fill="#59635f" fontSize="9" fontFamily="monospace">{fmtPrice(p0)}</text>
      <path d={path(ebay)} fill="none" stroke="#56b8d8" strokeWidth="1.2" opacity="0.85" />
      <path d={path(tcg)} fill="none" stroke="#35d0a5" strokeWidth="1.2" opacity="0.95" />
    </svg>
  );
}

function HistoryStats({ history }: { history: { tcgplayer: Snapshot[]; ebay: Snapshot[] } }) {
  const rows = useMemo(() => {
    return (['tcgplayer', 'ebay'] as const).map((src) => {
      const arr = history[src].filter((s) => s.marketPrice != null);
      if (arr.length < 2) return { src, d1: null as number | null, d7: null as number | null };
      const last = arr[arr.length - 1];
      const ref = (h: number) => {
        const cut = last.ts - h * 3600_000;
        let best = arr[0];
        for (const s of arr) if (s.ts <= cut) best = s;
        return best;
      };
      const pct = (a: Snapshot, b: Snapshot) =>
        a.marketPrice && b.marketPrice ? ((b.marketPrice - a.marketPrice) / a.marketPrice) * 100 : null;
      return { src, d1: pct(ref(24), last), d7: pct(ref(24 * 7), last) };
    });
  }, [history]);
  return (
    <table style={{ marginTop: 4 }}>
      <thead><tr><th className="l">VENUE</th><th>Δ24H</th><th>Δ7D</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.src}>
            <td className="l cyan">{r.src === 'tcgplayer' ? 'TCG' : 'EBAY'}</td>
            <td className={r.d1 == null ? 'dim' : r.d1 >= 0 ? 'up' : 'down'}>{r.d1 == null ? '—' : `${r.d1 >= 0 ? '+' : ''}${r.d1.toFixed(1)}%`}</td>
            <td className={r.d7 == null ? 'dim' : r.d7 >= 0 ? 'up' : 'down'}>{r.d7 == null ? '—' : `${r.d7 >= 0 ? '+' : ''}${r.d7.toFixed(1)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- feed / cmdline / statusbar ---------------- */

function FeedRow({ f, now }: { f: FeedItem; now: number }) {
  return (
    <div className="feed-item">
      <div className="feed-head">
        <span className="feed-handle">@{f.account}</span>
        <Prov p={f.provenance} source="X" ts={f.ts} now={now} />
        <span className="feed-time">{fmtAge(f.ts, now)}</span>
      </div>
      <div className={`feed-text ${f.provenance === 'sample' ? 'sample-text' : ''}`}>{f.text}</div>
    </div>
  );
}

function CommandLine({ onRun, msg, inputRef }: {
  onRun: (line: string) => void;
  msg: { text: string; err?: boolean };
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [val, setVal] = useState('');
  return (
    <div className="cmdline">
      <span className="prompt">RBT&gt;</span>
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onRun(val); setVal(''); }
        }}
        spellCheck={false}
        autoComplete="off"
        placeholder="S JINX · ALERT 1 BELOW 40 · PF ADD 1 4 38.50 · INJECT 1 JUMP 12 · K EBAY · HELP"
      />
      <span className={`msg ${msg.err ? 'err' : ''}`}>{msg.text}</span>
    </div>
  );
}

function StatusBar({ status, now }: { status: Status | null; now: number }) {
  return (
    <div className="statusbar">
      {(status?.sources ?? []).map((s) => <SourceChip key={s.source} h={s} now={now} />)}
      <span className="spring" />
      <span className="legend">
        PROV: <span className="prov live">LIVE</span> fetched · <span className="prov cached">CACH</span> aged ·{' '}
        <span className="prov stale">STALE</span> old · <span className="prov sample">SMPL</span> demo ·{' '}
        <span className="prov synthetic">SYNTH</span> injected
      </span>
    </div>
  );
}

function SourceChip({ h, now }: { h: SourceHealth; now: number }) {
  const label = h.source === 'tcgplayer' ? 'TCG' : h.source === 'ebay' ? 'EBAY' : 'WIRE';
  return (
    <span className="src" title={`${h.detail}\nlast ok: ${h.lastOkTs ? new Date(h.lastOkTs).toISOString() : 'never'}\nfailures: ${h.consecutiveFailures}`}>
      <span className={`dot ${h.state}`} />
      {label} <span className="dim">{h.state.toUpperCase()}{h.lastOkTs ? ` ${fmtAge(h.lastOkTs, now)}` : ''}</span>
    </span>
  );
}

/* ---------------- utils ---------------- */

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function normSource(s: string): SourceId | null {
  const t = s.trim().toLowerCase();
  if (t.startsWith('tcg')) return 'tcgplayer';
  if (t.startsWith('eb')) return 'ebay';
  if (t.startsWith('fe') || t.startsWith('wi') || t === 'x') return 'feed';
  return null;
}
