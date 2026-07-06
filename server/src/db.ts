import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import type { Card, FeedItem, Listing, PriceSnapshot, SourceId } from './types.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  number TEXT,
  rarity TEXT,
  finish TEXT,
  kind TEXT NOT NULL DEFAULT 'single',
  tcgplayer_product_id INTEGER UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id),
  source TEXT NOT NULL,
  ts INTEGER NOT NULL,
  market_price REAL,
  low_price REAL,
  listing_count INTEGER,
  sales_volume INTEGER,
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_card_src_ts ON price_snapshots(card_id, source, ts);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  card_id INTEGER,
  source TEXT NOT NULL,
  ts INTEGER NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL,
  shipping REAL,
  condition TEXT,
  url TEXT,
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_card ON listings(card_id, ts);

CREATE TABLE IF NOT EXISTS feed_items (
  id INTEGER PRIMARY KEY,
  account TEXT NOT NULL,
  author TEXT NOT NULL,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  url TEXT,
  provenance TEXT NOT NULL,
  UNIQUE(account, ts, text)
);
CREATE INDEX IF NOT EXISTS idx_feed_ts ON feed_items(ts DESC);

CREATE TABLE IF NOT EXISTS watchlist (
  card_id INTEGER PRIMARY KEY REFERENCES cards(id),
  added_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function rowToCard(r: any): Card {
  return {
    id: r.id,
    name: r.name,
    setName: r.set_name,
    number: r.number,
    rarity: r.rarity,
    finish: r.finish,
    kind: r.kind,
    tcgplayerProductId: r.tcgplayer_product_id,
  };
}

export const cardsRepo = {
  upsertByTcgProductId(c: Omit<Card, 'id'>): Card {
    if (c.tcgplayerProductId != null) {
      const existing = db
        .prepare('SELECT * FROM cards WHERE tcgplayer_product_id = ?')
        .get(c.tcgplayerProductId);
      if (existing) {
        db.prepare(
          'UPDATE cards SET name=?, set_name=?, number=?, rarity=?, finish=?, kind=? WHERE id=?',
        ).run(c.name, c.setName, c.number, c.rarity, c.finish, c.kind, (existing as any).id);
        return rowToCard({ ...existing, ...{ name: c.name } });
      }
    }
    const info = db
      .prepare(
        'INSERT INTO cards (name, set_name, number, rarity, finish, kind, tcgplayer_product_id) VALUES (?,?,?,?,?,?,?)',
      )
      .run(c.name, c.setName, c.number, c.rarity, c.finish, c.kind, c.tcgplayerProductId);
    return { ...c, id: Number(info.lastInsertRowid) };
  },
  byId(id: number): Card | null {
    const r = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
    return r ? rowToCard(r) : null;
  },
  all(): Card[] {
    return db.prepare('SELECT * FROM cards ORDER BY id').all().map(rowToCard);
  },
  search(q: string, limit = 25): Card[] {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const where = terms.map(() => "(lower(name || ' ' || set_name || ' ' || coalesce(number,'') || ' ' || coalesce(rarity,'')) LIKE ?)").join(' AND ');
    const params = terms.map((t) => `%${t}%`);
    return db
      .prepare(`SELECT * FROM cards WHERE ${where} ORDER BY length(name) LIMIT ?`)
      .all(...params, limit)
      .map(rowToCard);
  },
  count(): number {
    return (db.prepare('SELECT count(*) c FROM cards').get() as any).c;
  },
};

export const snapshotsRepo = {
  insert(s: PriceSnapshot) {
    db.prepare(
      `INSERT INTO price_snapshots (card_id, source, ts, market_price, low_price, listing_count, sales_volume, provenance)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(s.cardId, s.source, s.ts, s.marketPrice, s.lowPrice, s.listingCount, s.salesVolume, s.provenance);
  },
  insertMany(rows: PriceSnapshot[]) {
    const ins = db.prepare(
      `INSERT INTO price_snapshots (card_id, source, ts, market_price, low_price, listing_count, sales_volume, provenance)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    const tx = db.transaction((rs: PriceSnapshot[]) => {
      for (const s of rs)
        ins.run(s.cardId, s.source, s.ts, s.marketPrice, s.lowPrice, s.listingCount, s.salesVolume, s.provenance);
    });
    tx(rows);
  },
  latestForCard(cardId: number, source: SourceId): PriceSnapshot | null {
    const r = db
      .prepare('SELECT * FROM price_snapshots WHERE card_id=? AND source=? ORDER BY ts DESC LIMIT 1')
      .get(cardId, source) as any;
    return r ? mapSnap(r) : null;
  },
  seriesForCard(cardId: number, source: SourceId, sinceTs: number): PriceSnapshot[] {
    return (
      db
        .prepare('SELECT * FROM price_snapshots WHERE card_id=? AND source=? AND ts>=? ORDER BY ts')
        .all(cardId, source, sinceTs) as any[]
    ).map(mapSnap);
  },
  cardsWithData(): number[] {
    return (db.prepare('SELECT DISTINCT card_id FROM price_snapshots').all() as any[]).map((r) => r.card_id);
  },
};

function mapSnap(r: any): PriceSnapshot {
  return {
    id: r.id,
    cardId: r.card_id,
    source: r.source,
    ts: r.ts,
    marketPrice: r.market_price,
    lowPrice: r.low_price,
    listingCount: r.listing_count,
    salesVolume: r.sales_volume,
    provenance: r.provenance,
  };
}

export const listingsRepo = {
  insertMany(rows: Listing[]) {
    const ins = db.prepare(
      `INSERT INTO listings (card_id, source, ts, title, price, shipping, condition, url, provenance)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    const tx = db.transaction((rs: Listing[]) => {
      for (const l of rs)
        ins.run(l.cardId, l.source, l.ts, l.title, l.price, l.shipping, l.condition, l.url, l.provenance);
    });
    tx(rows);
  },
};

export const feedRepo = {
  insertMany(items: FeedItem[]): number {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO feed_items (account, author, ts, text, url, provenance) VALUES (?,?,?,?,?,?)`,
    );
    let added = 0;
    const tx = db.transaction((rs: FeedItem[]) => {
      for (const f of rs) {
        const r = ins.run(f.account, f.author, f.ts, f.text, f.url, f.provenance);
        added += r.changes;
      }
    });
    tx(items);
    return added;
  },
  latest(limit = 60): FeedItem[] {
    return (
      db.prepare('SELECT * FROM feed_items ORDER BY ts DESC LIMIT ?').all(limit) as any[]
    ).map((r) => ({
      id: r.id,
      account: r.account,
      author: r.author,
      ts: r.ts,
      text: r.text,
      url: r.url,
      provenance: r.provenance,
    }));
  },
  since(ts: number): FeedItem[] {
    return (
      db.prepare('SELECT * FROM feed_items WHERE ts>=? ORDER BY ts DESC').all(ts) as any[]
    ).map((r) => ({
      id: r.id,
      account: r.account,
      author: r.author,
      ts: r.ts,
      text: r.text,
      url: r.url,
      provenance: r.provenance,
    }));
  },
};

export const watchlistRepo = {
  add(cardId: number) {
    db.prepare('INSERT OR IGNORE INTO watchlist (card_id, added_ts) VALUES (?,?)').run(cardId, Date.now());
  },
  remove(cardId: number) {
    db.prepare('DELETE FROM watchlist WHERE card_id=?').run(cardId);
  },
  ids(): number[] {
    return (db.prepare('SELECT card_id FROM watchlist ORDER BY added_ts').all() as any[]).map((r) => r.card_id);
  },
};

export const kv = {
  get(key: string): string | null {
    const r = db.prepare('SELECT value FROM kv WHERE key=?').get(key) as any;
    return r ? r.value : null;
  },
  set(key: string, value: string) {
    db.prepare('INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  },
};
