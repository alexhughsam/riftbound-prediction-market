import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, fmtAge, fmtPrice, provTitle, PROV_LABEL,
  type CardQuote, type FeedItem, type Mover, type Provenance, type Snapshot, type SourceHealth, type SourceId, type Status,
} from './api';

type Zone = 'movers' | 'search' | 'feed';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [quotes, setQuotes] = useState<CardQuote[]>([]);
  const [searchLabel, setSearchLabel] = useState('');
  const [selCard, setSelCard] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ quote: CardQuote; history: { tcgplayer: Snapshot[]; ebay: Snapshot[] } } | null>(null);
  const [moverIdx, setMoverIdx] = useState(0);
  const [searchIdx, setSearchIdx] = useState(0);
  const [zone, setZone] = useState<Zone>('movers');
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: "type HELP for commands · '/' focuses command line" });
  const [now, setNow] = useState(Date.now());
  const cmdRef = useRef<HTMLInputElement>(null);

  const refreshCore = useCallback(async () => {
    const [st, mv] = await Promise.all([api.status(), api.movers()]);
    setStatus(st);
    setMovers(mv.movers);
  }, []);
  const refreshFeed = useCallback(async () => setFeed((await api.feed()).items), []);
  const searchedRef = useRef(false);
  const refreshBoard = useCallback(async () => {
    if (searchedRef.current) return;
    const r = await api.board();
    if (!searchedRef.current) setQuotes(r.quotes);
  }, []);

  useEffect(() => {
    void refreshCore();
    void refreshFeed();
    void refreshBoard();
    const es = new EventSource('/api/stream');
    es.addEventListener('cycle', () => { void refreshCore(); void refreshFeed(); void refreshBoard(); });
    es.addEventListener('feed', () => void refreshFeed());
    es.addEventListener('health', () => void refreshCore());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { es.close(); clearInterval(clock); };
  }, [refreshCore, refreshFeed, refreshBoard]);

  useEffect(() => {
    if (selCard == null) return setDetail(null);
    let dead = false;
    const load = () => api.card(selCard).then((d) => { if (!dead) setDetail(d); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { dead = true; clearInterval(t); };
  }, [selCard, status?.cycleCount]);

  // keep selection following the movers panel unless user picked elsewhere
  useEffect(() => {
    if (zone === 'movers' && movers[moverIdx]) setSelCard(movers[moverIdx].cardId);
  }, [movers, moverIdx, zone]);

  const runCommand = useCallback(async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    const c = cmd.toLowerCase();
    try {
      if (c === 'help' || c === '?') {
        setMsg({ text: 'S <card[,card…]> search · W/UW <row> watch · O <row> open · K/R tcg|ebay|feed kill/restore · INJECT <row> JUMP|VOL [pct] · MV/FD focus' });
      } else if (c === 's' || c === 'search') {
        const r = await api.search(arg);
        searchedRef.current = true;
        setQuotes(r.quotes); setSearchLabel(arg); setSearchIdx(0); setZone('search');
        if (r.quotes[0]) setSelCard(r.quotes[0].card.id);
        setMsg({ text: `${r.quotes.length} result(s) for "${arg}"` });
      } else if (c === 'w' || c === 'watch') {
        const q = quotes[Number(arg) - 1] ?? (selCard != null ? { card: { id: selCard } } : null);
        if (!q) throw new Error('no row selected');
        await api.watch(q.card.id); setMsg({ text: `watching card #${q.card.id}` });
      } else if (c === 'uw' || c === 'unwatch') {
        const q = quotes[Number(arg) - 1] ?? (selCard != null ? { card: { id: selCard } } : null);
        if (!q) throw new Error('no row selected');
        await api.unwatch(q.card.id); setMsg({ text: `unwatched card #${q.card.id}` });
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
        const target = quotes[Number(rowS) - 1]?.card.id ?? movers[Number(rowS) - 1]?.cardId ?? selCard;
        if (target == null) throw new Error('usage: INJECT <row> JUMP|VOL [pct]');
        const kind = /vol/i.test(kindS ?? '') ? 'volume_spike' : 'price_jump';
        await api.inject(target, kind, pctS ? Number(pctS) : undefined);
        setMsg({ text: `SYNTHETIC ${kind} injected on card #${target} — watch MOVERS` });
      } else if (c === 'mv' || c === 'movers') { setZone('movers');
      } else if (c === 'fd' || c === 'feed') { setZone('feed');
      } else {
        // bare text = search
        const r = await api.search(line);
        searchedRef.current = true;
        setQuotes(r.quotes); setSearchLabel(line); setSearchIdx(0); setZone('search');
        if (r.quotes[0]) setSelCard(r.quotes[0].card.id);
        setMsg({ text: `${r.quotes.length} result(s) for "${line}"` });
      }
    } catch (err: any) {
      setMsg({ text: String(err?.message ?? err).slice(0, 120), err: true });
    }
  }, [quotes, movers, selCard, refreshCore]);

  // global keys
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

  return (
    <div className="term">
      <TopBar status={status} now={now} />
      <div className="main">
        <div className={`panel ${zone === 'movers' ? 'focused' : ''}`}>
          {isSample && <div className="banner-sample">SAMPLE DATA — SIMULATED MARKET · NO REAL PRICES ON SCREEN</div>}
          <div className="panel-title">MOVERS — EARLY SIGNAL <span className="cnt">{movers.length}</span>
            <span className="hint">↑↓ select · ⏎ detail · score = |Δ24h| + activityσ + spread</span>
          </div>
          <div className="panel-body">
            <MoversTable movers={movers} sel={zone === 'movers' ? moverIdx : -1} now={now}
              onPick={(i) => { setZone('movers'); setMoverIdx(i); setSelCard(movers[i].cardId); }} />
          </div>
          {movers[moverIdx] && zone === 'movers' && <WhyLine mover={movers[moverIdx]} now={now} />}
        </div>

        <div className={`panel ${zone === 'search' ? 'focused' : ''}`}>
          <div className="panel-title">{searchLabel ? <>SEARCH / QUOTES <span className="cnt">“{truncate(searchLabel, 42)}”</span></> : <>BOARD — TOP VALUE <span className="cnt">{quotes.length}</span></>}
            <span className="hint">S name[, name…] · best px across TCG+EBAY</span>
          </div>
          <div className="panel-body">
            <SearchTable quotes={quotes} sel={zone === 'search' ? searchIdx : -1} now={now}
              onPick={(i) => { setZone('search'); setSearchIdx(i); setSelCard(quotes[i].card.id); }} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">CARD DETAIL {detail && <span className="cnt">#{detail.quote.card.id}</span>}
            <span className="hint">avg = source market px · best = lowest ask incl. ship where known</span>
          </div>
          <div className="panel-body">
            <DetailPanel detail={detail} now={now} movers={movers} />
          </div>
        </div>

        <div className={`panel ${zone === 'feed' ? 'focused' : ''}`}>
          <div className="panel-title">WIRE — X FEED <span className="cnt">{feed.length}</span>
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

/* ---------------- components ---------------- */

function TopBar({ status, now }: { status: Status | null; now: number }) {
  const countdown = status ? Math.max(0, Math.ceil((status.nextCycleTs - now) / 1000)) : null;
  const overall = status?.overall ?? 'down';
  return (
    <div className="topbar">
      <span className="brand">RBT<span className="blk">▮</span> RIFTBOUND TERMINAL</span>
      <span className={`mode-badge ${overall}`}>{status ? overall.toUpperCase() : '·····'}</span>
      <span className="kv">MKTS <b>TCGPLAYER · EBAY</b></span>
      <span className="sep">│</span>
      <span className="kv">CARDS <b>{status?.cards ?? '—'}</b></span>
      <span className="sep">│</span>
      <span className="kv">CYCLE <b>#{status?.cycleCount ?? '—'}</b> NEXT <b>{countdown != null ? `${countdown}s` : '—'}</b></span>
      <span className="spring" />
      <span className="kv">{new Date(now).toISOString().slice(0, 19).replace('T', ' ')} UTC</span>
    </div>
  );
}

function Prov({ p, source, ts, now }: { p: Provenance | null; source: string; ts: number | null; now: number }) {
  if (!p) return null;
  return <span className={`prov ${p}`} title={provTitle(p, source, ts, now)}>{PROV_LABEL[p]}</span>;
}

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
                {m.pct24h == null ? '—' : `${m.pct24h >= 0 ? '+' : ''}${m.pct24h.toFixed(1)}%`}
              </td>
              <td className={m.volumeZ != null && m.volumeZ >= 1.5 ? 'amber' : 'dim'}>
                {m.volumeZ == null ? '—' : `${m.volumeZ.toFixed(1)}σ`}
              </td>
              <td className={m.spreadPct != null && m.spreadPct >= 4 ? 'cyan' : 'dim'}>
                {m.spreadPct == null ? '—' : `${m.spreadPct.toFixed(0)}%`}
              </td>
              <td>{tcg ? <>{fmtPrice(tcg.price)}<Prov p={tcg.provenance} source="TCGplayer" ts={tcg.ts} now={now} /></> : <span className="faint">—</span>}</td>
              <td>{eb ? <>{fmtPrice(eb.price)}<Prov p={eb.provenance} source="eBay" ts={eb.ts} now={now} /></> : <span className="faint">—</span>}</td>
              <td className="l"><span className="scorebar" style={{ width: `${Math.max(3, (m.score / maxScore) * 56)}px` }} /> <span className="dim">{m.score.toFixed(1)}</span></td>
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
      <div className="factors">
        {mover.why.factors.join(' · ')}
        {mover.why.feedRefs.map((r, i) => (
          <span key={i}> · <span className="fref">@{r.account}</span> <span className="faint">({fmtAge(r.ts, now)} ago):</span> “{truncate(r.text, 90)}”</span>
        ))}
      </div>
    </div>
  );
}

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

function DetailPanel({ detail, now, movers }: {
  detail: { quote: CardQuote; history: { tcgplayer: Snapshot[]; ebay: Snapshot[] } } | null;
  now: number;
  movers: Mover[];
}) {
  if (!detail) return <div className="empty">select a mover or search result — ⏎ opens it here</div>;
  const { quote, history } = detail;
  const mover = movers.find((m) => m.cardId === quote.card.id);
  return (
    <div className="detail-grid">
      <div className="detail-left">
        <div className="detail-name">{quote.card.name}</div>
        <div className="detail-sub">
          {quote.card.setName}{quote.card.number ? ` · ${quote.card.number}` : ''}
          {quote.card.rarity ? ` · ${quote.card.rarity}` : ''} · {quote.card.kind.toUpperCase()}
        </div>
        <table>
          <thead>
            <tr><th className="l">VENUE</th><th>AVG</th><th>BEST</th><th>LSTG</th><th>AGE</th><th className="l">STATE</th></tr>
          </thead>
          <tbody>
            {quote.perSource.map((p) => (
              <tr key={p.source}>
                <td className="l cyan">{p.source.toUpperCase()}</td>
                <td>{fmtPrice(p.avgPrice)}<Prov p={p.provenance} source={p.source} ts={p.ts} now={now} /></td>
                <td className={p.bestPrice != null && quote.best?.source === p.source ? 'up' : ''}>{fmtPrice(p.bestPrice)}</td>
                <td className="dim">{p.listingCount ?? '—'}</td>
                <td className="dim">{fmtAge(p.ts, now)}</td>
                <td className={`l ${p.state === 'live' ? 'up' : p.state === 'down' ? 'down' : 'dim'}`}>{p.state.toUpperCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {quote.best && (
          <div className="kvrow" style={{ marginTop: 4 }}>
            <span className="k">BEST NOW</span>
            <span><span className="up">{fmtPrice(quote.best.price)}</span> on <span className="cyan">{quote.best.source.toUpperCase()}</span>
              <Prov p={quote.best.provenance} source={quote.best.source} ts={quote.best.ts} now={now} /></span>
          </div>
        )}
        {mover && (
          <div style={{ marginTop: 4 }}>
            <div className="k faint">SIGNAL READ</div>
            <div>{mover.why.headline}</div>
            <div className="dim">{mover.why.factors.join(' · ')}</div>
          </div>
        )}
      </div>
      <div className="detail-right">
        <div className="legendline">14D — <span className="amber">▬ TCG</span> <span className="cyan">▬ EBAY</span> (market px)</div>
        <Sparkline tcg={history.tcgplayer} ebay={history.ebay} />
        <HistoryStats history={history} />
      </div>
    </div>
  );
}

function Sparkline({ tcg, ebay }: { tcg: Snapshot[]; ebay: Snapshot[] }) {
  const W = 220, H = 84;
  const all = [...tcg, ...ebay].filter((s) => s.marketPrice != null);
  if (all.length < 2) return <div className="empty">not enough history</div>;
  const t0 = Math.min(...all.map((s) => s.ts));
  const t1 = Math.max(...all.map((s) => s.ts));
  const p0 = Math.min(...all.map((s) => s.marketPrice as number));
  const p1 = Math.max(...all.map((s) => s.marketPrice as number));
  const px = (ts: number) => ((ts - t0) / Math.max(1, t1 - t0)) * (W - 4) + 2;
  const py = (p: number) => H - 4 - ((p - p0) / Math.max(0.0001, p1 - p0)) * (H - 12);
  const path = (arr: Snapshot[]) =>
    arr.filter((s) => s.marketPrice != null).map((s, i) => `${i ? 'L' : 'M'}${px(s.ts).toFixed(1)},${py(s.marketPrice as number).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" width={W} height={H}>
      <rect x="0" y="0" width={W} height={H} fill="#0a0e13" stroke="#1b232c" />
      <text x="3" y="10" fill="#454f5a" fontSize="9">{fmtPrice(p1)}</text>
      <text x="3" y={H - 3} fill="#454f5a" fontSize="9">{fmtPrice(p0)}</text>
      <path d={path(ebay)} fill="none" stroke="#46b8da" strokeWidth="1" opacity="0.9" />
      <path d={path(tcg)} fill="none" stroke="#e8a33d" strokeWidth="1" opacity="0.95" />
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
        placeholder="S JINX · W 1 · INJECT 1 JUMP 12 · K EBAY · HELP"
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
