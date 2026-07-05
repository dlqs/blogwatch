// blogwatch poller
// Reads blogs.json + the previous data.json, fetches each blog's feed (or
// scrapes it), records the SINGLE latest post per blog, and self-hosts each
// blog's favicon under icons/. "Latest" = newest by published date, falling
// back to firstSeen (when we first saw a URL) for dateless sources like PG.
// State lives in data.json (committed by CI); no server, no DB.

import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const UA = 'blogwatch/1.0 (+https://blogwatch.dlqs.xyz; personal blog watcher)';
const ITEMS_PER_BLOG = 10;   // candidates pulled from each feed to find the latest
const FETCH_TIMEOUT_MS = 20000;
const COMMON_FEED_PATHS = [
  '/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml',
];
const ICON_DIR = new URL('./icons/', import.meta.url);

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

async function fetchBinary(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'image/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: (res.headers.get('content-type') || '').toLowerCase() };
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeFeed(text) {
  const head = text.slice(0, 600).toLowerCase();
  return head.includes('<rss') || head.includes('<feed') ||
    head.includes('<rdf') || (head.includes('<?xml') && head.includes('<channel'));
}

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

function iconExt(url, ct) {
  if (ct.includes('svg') || url.endsWith('.svg')) return '.svg';
  if (ct.includes('png') || url.endsWith('.png')) return '.png';
  if (ct.includes('jpeg') || /\.jpe?g($|\?)/.test(url)) return '.jpg';
  if (ct.includes('gif') || url.endsWith('.gif')) return '.gif';
  if (ct.includes('webp') || url.endsWith('.webp')) return '.webp';
  return '.ico';
}

// Resolve + download a blog's favicon once, into icons/<host><ext>. Reuses the
// previously-saved file when present (favicons rarely change), so steady-state
// runs make no extra requests. Returns a repo-relative path or null.
async function ensureIcon(blog, prevIcon) {
  const host = new URL(blog.url).hostname;
  if (prevIcon) {
    try { await access(new URL(`./${prevIcon}`, import.meta.url)); return prevIcon; } catch { /* re-fetch */ }
  }

  const cands = [];
  try {
    const $ = cheerio.load(await fetchText(blog.url));
    $('link[rel]').each((_, el) => {
      const rel = ($(el).attr('rel') || '').toLowerCase();
      // mask-icons are monochrome silhouettes, not real favicons — skip them
      if (!rel.includes('icon') || rel.includes('mask-icon')) return;
      const href = $(el).attr('href');
      if (!href) return;
      const type = ($(el).attr('type') || '').toLowerCase();
      const size = parseInt(($(el).attr('sizes') || '').match(/(\d+)x/)?.[1] || '0', 10);
      let score = Math.min(size, 128);
      if (type.includes('svg') || href.endsWith('.svg')) score += 90;
      if (rel.includes('apple')) score += 40;
      cands.push({ url: new URL(href, blog.url).href, score });
    });
    cands.sort((a, b) => b.score - a.score);
  } catch { /* fall through to /favicon.ico */ }
  cands.push({ url: new URL('/favicon.ico', blog.url).href, score: -1 }); // last resort

  const tried = new Set();
  for (const c of cands) {
    if (tried.has(c.url)) continue;
    tried.add(c.url);
    try {
      const { buffer, contentType } = await fetchBinary(c.url);
      if (!isImage(buffer, contentType)) continue;
      await mkdir(ICON_DIR, { recursive: true });
      const file = `${host}${iconExt(c.url, contentType)}`;
      await writeFile(new URL(`./${file}`, ICON_DIR), buffer);
      return `icons/${file}`;
    } catch { /* try next candidate */ }
  }
  return prevIcon || null;
}

// Accept real images (incl. SVG, which starts with '<'); reject HTML error pages.
function isImage(buffer, ct) {
  if (buffer.length < 20 || ct.includes('html')) return false;
  const head = buffer.slice(0, 64).toString('utf8').toLowerCase().trimStart();
  return !(head.startsWith('<!doctype') || head.startsWith('<html'));
}

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
    return scrapePosts(blog, await fetchText(blog.url));
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

  let prev = { generatedAt: null, blogs: [], seen: {} };
  try {
    prev = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
  } catch { /* first run */ }
  const seenPrev = prev.seen || {};
  const prevLatest = new Map((prev.blogs || []).map((b) => [b.name, b.latest]).filter(([, l]) => l));
  const prevIcon = new Map((prev.blogs || []).map((b) => [b.name, b.icon]).filter(([, i]) => i));

  const now = new Date().toISOString();
  const seenNew = {};
  const outBlogs = [];

  for (const blog of blogs) {
    const status = { name: blog.name, url: blog.url, icon: null, ok: true, error: null, latest: null };
    try {
      const items = await collectPosts(blog);
      if (!items.length) throw new Error('no items found');
      const enriched = items.map((it) => {
        const firstSeen = seenPrev[it.url] || now;
        seenNew[it.url] = firstSeen;
        return { ...it, firstSeen };
      });
      enriched.sort((a, b) => sortKey(b) - sortKey(a));
      const latest = enriched[0];
      status.latest = { title: cleanTitle(latest.title), url: latest.url, published: latest.published, firstSeen: latest.firstSeen };
      console.log(`ok   ${blog.name}: ${items.length} items -> "${status.latest.title}"`);
    } catch (err) {
      status.ok = false;
      status.error = String((err && err.message) || err);
      const carried = prevLatest.get(blog.name);
      if (carried) { status.latest = carried; seenNew[carried.url] = carried.firstSeen; }
      console.warn(`FAIL ${blog.name}: ${status.error}`);
    }
    status.icon = await ensureIcon(blog, prevIcon.get(blog.name));
    outBlogs.push(status);
  }

  // Only bump generatedAt (and thus produce a git diff / commit) when the
  // meaningful content actually changed — avoids an hourly no-op commit.
  const payload = { blogs: outBlogs, seen: seenNew };
  const prevPayload = { blogs: (prev.blogs || []).map(({ name, url, icon, ok, error, latest }) => ({ name, url, icon: icon ?? null, ok, error, latest })), seen: prev.seen || {} };
  const changed = JSON.stringify(payload) !== JSON.stringify(prevPayload);
  const generatedAt = changed || !prev.generatedAt ? now : prev.generatedAt;

  await writeFile(new URL('./data.json', import.meta.url), JSON.stringify({ generatedAt, ...payload }, null, 2) + '\n');

  const okCount = outBlogs.filter((b) => b.ok).length;
  console.log(`\nWrote data.json — ${okCount}/${outBlogs.length} blogs ok, content ${changed ? 'changed' : 'unchanged'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
