import { config } from '../config.js';
import type { FeedAdapter, FeedItem, SourceHealth } from '../types.js';
import { SourceRuntime, fetchJson, fetchText } from './runtime.js';

/**
 * Feed adapter: pulls recent posts for the configured X accounts.
 * Order of preference:
 *   1. twitterapi.io (pay-per-request, needs TWITTERAPI_IO_KEY)
 *   2. Nitter RSS (free, best-effort — instances rotate)
 * Without either, the feed reports itself as 'disabled' and the sample layer
 * (if active) supplies clearly-labeled SAMPLE items instead.
 */
export class XFeedAdapter implements FeedAdapter {
  readonly id = 'feed' as const;
  private rt = new SourceRuntime('feed', 3000, 'X feed');
  private via: 'twitterapi.io' | 'nitter' | null = null;

  get configured(): boolean {
    return Boolean(config.twitterApiIoKey) || config.nitterInstances.length > 0;
  }

  health(): SourceHealth {
    const h = this.rt.health();
    if (this.rt.isForced) return h;
    if (!config.twitterApiIoKey && h.lastOkTs == null && h.consecutiveFailures === 0) {
      return { ...h, state: 'degraded', detail: 'no TWITTERAPI_IO_KEY; will try Nitter RSS (best-effort)' };
    }
    return { ...h, detail: this.via ? `via ${this.via}: ${h.detail}` : h.detail };
  }

  force(state: Parameters<SourceRuntime['force']>[0], detail?: string) {
    this.rt.force(state, detail);
  }

  async poll(): Promise<FeedItem[]> {
    const out: FeedItem[] = [];
    for (const account of config.feedAccounts) {
      let items: FeedItem[] | null = null;
      if (config.twitterApiIoKey) {
        items = await this.viaTwitterApiIo(account).catch(() => null);
        if (items) this.via = 'twitterapi.io';
      }
      if (!items) {
        items = await this.viaNitter(account).catch(() => null);
        if (items) this.via = 'nitter';
      }
      if (items) out.push(...items);
    }
    if (!out.length && config.feedAccounts.length) throw new Error('all feed paths failed');
    return out;
  }

  private async viaTwitterApiIo(account: string): Promise<FeedItem[]> {
    const data = await this.rt.guard(() =>
      fetchJson(`https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(account)}`, {
        headers: { 'x-api-key': config.twitterApiIoKey },
      }),
    );
    const tweets: any[] = data?.data?.tweets ?? data?.tweets ?? [];
    return tweets.map((t) => ({
      account,
      author: t.author?.name ?? account,
      ts: new Date(t.createdAt ?? t.created_at ?? Date.now()).getTime(),
      text: t.text ?? '',
      url: t.url ?? `https://x.com/${account}/status/${t.id}`,
      provenance: 'live' as const,
    }));
  }

  private async viaNitter(account: string): Promise<FeedItem[]> {
    let lastErr: unknown = new Error('no nitter instances configured');
    for (const base of config.nitterInstances) {
      try {
        const xml = await this.rt.guard(() => fetchText(`${base}/${account}/rss`));
        return parseRss(xml, account);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
}

/** Minimal RSS parser — enough for Nitter's simple item structure. */
export function parseRss(xml: string, account: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = decodeXml(pick(block, 'title'));
    const link = pick(block, 'link');
    const pubDate = pick(block, 'pubDate');
    const creator = decodeXml(pick(block, 'dc:creator')) || `@${account}`;
    if (!title) continue;
    items.push({
      account,
      author: creator.replace(/^@/, ''),
      ts: pubDate ? new Date(pubDate).getTime() : Date.now(),
      text: title,
      url: link || null,
      provenance: 'live',
    });
  }
  return items;
}

function pick(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(block);
  return m ? m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim() : '';
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
