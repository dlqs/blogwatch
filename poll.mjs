// blogwatch poller
// Reads blogs.json + the previous data.json, fetches each blog's feed (or
// scrapes it), and records the SINGLE latest post per blog — so a daily poster
// never crowds out a yearly one. "Latest" = newest by published date, falling
// back to firstSeen (when we first saw a URL) for dateless sources like PG.
// State lives in data.json (committed by CI); no server, no DB.

import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'blogwatch/1.0 (+https://blogwatch.dlqs.xyz; personal blog watcher)';
const ITEMS_PER_BLOG = 10;   // candidates pulled from each feed to find the latest
const FETCH_TIMEOUT_MS = 20000;
const COMMON_FEED_PATHS = [
  '/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml',
];

const parser = new Parser({ headers: { 'User-Agent': UA } });

async function fetchText(url, accept = 'text/html,application/xhtml+xml,application/xml') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: accept },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeFeed(text) {
  const head = text.slice(0, 600).toLowerCase();
  return head.includes('<rss') || head.includes('<feed') ||
    head.includes('<rdf') || (head.includes('<?xml') && head.includes('<channel'));
}

// Resolve a feed URL: explicit blog.feed -> <link rel=alternate> discovery ->
// common paths. Throws if nothing usable is found.
async function discoverFeed(blog) {
  if (blog.feed) return blog.feed;

  const html = await fetchText(blog.url);
  const $ = cheerio.load(html);
  const link = $('link[rel~="alternate"]')
    .filter((_, el) => {
      const type = ($(el).attr('type') || '').toLowerCase();
      return type.includes('rss') || type.includes('atom') || type.includes('xml');
    })
    .first();
  const href = link.attr('href');
  if (href) return new URL(href, blog.url).href;

  for (const path of COMMON_FEED_PATHS) {
    const candidate = new URL(path, blog.url).href;
    try {
      const body = await fetchText(candidate, 'application/rss+xml,application/atom+xml,application/xml');
      if (looksLikeFeed(body)) return candidate;
    } catch { /* try next */ }
  }
  throw new Error('no feed found (set "feed" in blogs.json or add a scrape block)');
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cleanTitle(title) {
  const t = (title || '').trim();
  return t && !/^[-–—•·.]+$/.test(t) ? t : '(untitled)';
}

// Scrape fallback for feed-less sites. blog.scrape:
//   { item, title?, link?, date?, include?, exclude?, limit? }
// `item` selects candidate nodes; when a node is itself an <a> the link is the
// node. `include`/`exclude` are regexes tested against the raw href — used e.g.
// for Paul Graham, whose articles.html is a flat, undated list of essay links.
function scrapePosts(blog, html) {
  const $ = cheerio.load(html);
  const cfg = blog.scrape;
  const limit = cfg.limit || ITEMS_PER_BLOG;
  const include = cfg.include ? new RegExp(cfg.include, 'i') : null;
  const exclude = cfg.exclude ? new RegExp(cfg.exclude, 'i') : null;
  const out = [];
  const seen = new Set();

  $(cfg.item).each((_, el) => {
    if (out.length >= limit) return;
    const node = $(el);
    const linkEl = cfg.link ? node.find(cfg.link).first()
      : (node.is('a') ? node : node.find('a').first());
    const href = linkEl.attr('href');
    if (!href) return;
    if (include && !include.test(href)) return;
    if (exclude && exclude.test(href)) return;

    const url = new URL(href, blog.url).href;
    if (seen.has(url)) return;
    seen.add(url);

    const titleEl = cfg.title ? node.find(cfg.title).first() : linkEl;
    const title = (titleEl.text() || '').trim();
    if (!title) return;
    const dateRaw = cfg.date
      ? (node.find(cfg.date).attr('datetime') || node.find(cfg.date).first().text())
      : null;
    out.push({ title, url, published: toIso(dateRaw) });
  });
  return out;
}

async function collectPosts(blog) {
  if (!blog.feed && blog.scrape) {
    const html = await fetchText(blog.url);
    return scrapePosts(blog, html);
  }
  const feedUrl = await discoverFeed(blog);
  const xml = await fetchText(feedUrl, 'application/rss+xml,application/atom+xml,application/xml');
  const parsed = await parser.parseString(xml);
  return (parsed.items || []).slice(0, ITEMS_PER_BLOG).map((it) => ({
    title: (it.title || '').trim(),
    url: it.link ? new URL(it.link, blog.url).href : blog.url,
    published: toIso(it.isoDate || it.pubDate || it.date),
  }));
}

const sortKey = (p) => Date.parse(p.published || p.firstSeen) || 0;

async function main() {
  const blogs = JSON.parse(await readFile(new URL('./blogs.json', import.meta.url), 'utf8'));

  let prev = { blogs: [], seen: {} };
  try {
    prev = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
  } catch { /* first run */ }
  const seenPrev = prev.seen || {};
  const prevLatest = new Map((prev.blogs || []).map((b) => [b.name, b.latest]).filter(([, l]) => l));

  const now = new Date().toISOString();
  const seenNew = {};
  const outBlogs = [];

  for (const blog of blogs) {
    const status = { name: blog.name, url: blog.url, ok: true, error: null, lastChecked: now, latest: null };
    try {
      const items = await collectPosts(blog);
      if (!items.length) throw new Error('no items found');

      // stamp firstSeen (carried from prior runs) and remember it for next time
      const enriched = items.map((it) => {
        const firstSeen = seenPrev[it.url] || now;
        seenNew[it.url] = firstSeen;
        return { ...it, firstSeen };
      });
      enriched.sort((a, b) => sortKey(b) - sortKey(a));
      const latest = enriched[0];
      status.latest = {
        title: cleanTitle(latest.title),
        url: latest.url,
        published: latest.published,
        firstSeen: latest.firstSeen,
      };
      console.log(`ok   ${blog.name}: ${items.length} items -> "${status.latest.title}"`);
    } catch (err) {
      status.ok = false;
      status.error = String((err && err.message) || err);
      const carried = prevLatest.get(blog.name);
      if (carried) {
        status.latest = carried;                 // don't drop the blog on a transient failure
        seenNew[carried.url] = carried.firstSeen;
      }
      console.warn(`FAIL ${blog.name}: ${status.error}`);
    }
    outBlogs.push(status);
  }

  const data = { generatedAt: now, blogs: outBlogs, seen: seenNew };
  await writeFile(new URL('./data.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');

  const okCount = outBlogs.filter((b) => b.ok).length;
  console.log(`\nWrote data.json — ${okCount}/${outBlogs.length} blogs ok.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
