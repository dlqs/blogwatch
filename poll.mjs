// blogwatch poller
// Reads blogs.json + the previous data.json, fetches each blog's feed, computes
// what's new (stable firstSeen), and writes a fresh data.json for the static UI.
// No server, no DB — state lives in data.json, committed by CI each run.

import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'blogwatch/1.0 (+https://blogwatch.dlqs.xyz; personal blog watcher)';
const ITEMS_PER_BLOG = 10;   // newest N items pulled from each feed
const TIMELINE_CAP = 120;    // bound on data.json size / firstSeen memory
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

// Scrape fallback for feed-less sites: blog.scrape = { item, title, link, date }
function scrapePosts(blog, html) {
  const $ = cheerio.load(html);
  const cfg = blog.scrape;
  const out = [];
  $(cfg.item).slice(0, ITEMS_PER_BLOG).each((_, el) => {
    const node = $(el);
    const titleEl = cfg.title ? node.find(cfg.title).first() : node;
    const linkEl = cfg.link ? node.find(cfg.link).first() : node.find('a').first();
    const href = linkEl.attr('href');
    if (!href) return;
    const dateRaw = cfg.date
      ? (node.find(cfg.date).attr('datetime') || node.find(cfg.date).first().text())
      : null;
    out.push({
      title: (titleEl.text() || '(untitled)').trim(),
      url: new URL(href, blog.url).href,
      published: toIso(dateRaw),
    });
  });
  return out;
}

async function collectPosts(blog) {
  if (!blog.feed && blog.scrape) {
    const html = await fetchText(blog.url);
    const raw = scrapePosts(blog, html);
    return { feed: null, items: raw };
  }
  const feedUrl = await discoverFeed(blog);
  const xml = await fetchText(feedUrl, 'application/rss+xml,application/atom+xml,application/xml');
  const parsed = await parser.parseString(xml);
  const items = (parsed.items || []).slice(0, ITEMS_PER_BLOG).map((it) => ({
    title: (it.title || '(untitled)').trim(),
    url: it.link ? new URL(it.link, blog.url).href : blog.url,
    published: toIso(it.isoDate || it.pubDate || it.date),
  }));
  return { feed: feedUrl, items };
}

async function main() {
  const blogs = JSON.parse(await readFile(new URL('./blogs.json', import.meta.url), 'utf8'));

  let prev = { posts: [] };
  try {
    prev = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
  } catch { /* first run */ }

  const firstSeenByUrl = new Map((prev.posts || []).map((p) => [p.url, p.firstSeen]));
  const prevByBlog = new Map();
  for (const p of prev.posts || []) {
    if (!prevByBlog.has(p.blog)) prevByBlog.set(p.blog, []);
    prevByBlog.get(p.blog).push(p);
  }

  const now = new Date().toISOString();
  const blogStatuses = [];
  const allPosts = [];

  for (const blog of blogs) {
    const status = { name: blog.name, url: blog.url, feed: blog.feed || null, ok: true, error: null, lastChecked: now };
    try {
      const { feed, items } = await collectPosts(blog);
      status.feed = feed || blog.feed || null;
      for (const it of items) {
        allPosts.push({
          blog: blog.name,
          blogUrl: blog.url,
          title: it.title,
          url: it.url,
          published: it.published,
          firstSeen: firstSeenByUrl.get(it.url) || now,
        });
      }
      console.log(`ok   ${blog.name}: ${items.length} items`);
    } catch (err) {
      status.ok = false;
      status.error = String((err && err.message) || err);
      // keep the last-known posts so a transient failure doesn't blank the timeline
      allPosts.push(...(prevByBlog.get(blog.name) || []));
      console.warn(`FAIL ${blog.name}: ${status.error}`);
    }
    blogStatuses.push(status);
  }

  // dedupe by url (carried-forward posts may overlap a recovered feed)
  const seen = new Set();
  const deduped = [];
  for (const p of allPosts) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    deduped.push(p);
  }
  deduped.sort((a, b) => {
    const ta = Date.parse(a.published || a.firstSeen) || 0;
    const tb = Date.parse(b.published || b.firstSeen) || 0;
    return tb - ta;
  });

  const posts = deduped.slice(0, TIMELINE_CAP);
  const data = { generatedAt: now, blogs: blogStatuses, posts };
  await writeFile(new URL('./data.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');

  const okCount = blogStatuses.filter((b) => b.ok).length;
  console.log(`\nWrote data.json — ${posts.length} posts, ${okCount}/${blogStatuses.length} blogs ok.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
