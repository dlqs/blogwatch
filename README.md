# blogwatch

A tiny personal dashboard that watches a hand-picked list of blogs and shows the
**latest post from each** (one row per blog, newest first), linking out to the
original article. One row per blog means a daily poster never crowds out a yearly
one. It never mirrors content — it just tells you *when* something new went up.

Live at **https://blogwatch.dlqs.xyz**.

## How it works

- `blogs.json` is the watchlist.
- An hourly GitHub Action runs `poll.mjs`, which fetches each blog's RSS/Atom
  feed (auto-discovering it when not given), records each blog's latest post, and
  commits `data.json`.
- The static page (`index.html` + `app.js`) renders one row per blog, newest
  first, with a **NEW** badge on posts first seen in the last 48h.
- Dateless sources (e.g. Paul Graham, who has no feed) are scraped, and their
  "latest" is inferred from when a link first appears — so a new essay still
  surfaces.

No server, no database.

## Add a blog

Add an entry to `blogs.json` and push:

```json
{ "name": "Some Blog", "url": "https://example.com/", "feed": "https://example.com/feed" }
```

`feed` is optional — omit it to let the poller auto-discover the feed. For a site
with no feed at all, add a `scrape` selector block (see `poll.mjs`).

## Local dev

```bash
npm install
node poll.mjs            # regenerates data.json
python3 -m http.server 8080
# open http://localhost:8080
```
