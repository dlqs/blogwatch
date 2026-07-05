# blogwatch

A tiny personal dashboard that watches a hand-picked list of blogs and shows a
unified timeline of their **new posts**, linking out to each original article.
It never mirrors content — it just tells you *when* something new went up.

Live at **https://blogwatch.dlqs.xyz**.

## How it works

- `blogs.json` is the watchlist.
- An hourly GitHub Action runs `poll.mjs`, which fetches each blog's RSS/Atom
  feed (auto-discovering it when not given), figures out what's new, and commits
  `data.json`.
- The static page (`index.html` + `app.js`) renders `data.json` as a
  reverse-chronological timeline with a **NEW** badge on recent posts.

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
