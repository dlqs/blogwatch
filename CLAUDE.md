# blogwatch

Personal "new post" watcher for a hand-picked list of blogs, live at
https://blogwatch.dlqs.xyz. Static site on GitHub Pages; an hourly GitHub Action
polls each blog's feed and commits `data.json`. Links out to the original posts
only — it never mirrors content.

## Layout
- `blogs.json` — the watchlist (edit this). `{ name, url, feed?, scrape? }`.
- `poll.mjs` — resolves each feed (explicit `feed` → `<link rel=alternate>`
  discovery → common paths like `/feed`, `/atom.xml`), parses with `rss-parser`,
  computes new posts with a stable `firstSeen`, writes `data.json`. A blog with
  no feed can carry a `scrape` CSS-selector block. Node 20; deps: rss-parser,
  cheerio.
- `index.html` + `app.js` + `styles.css` — vanilla unified-timeline UI (no build).
- `data.json` — generated output, committed by CI. Holds the last ~120 posts.
- `.github/workflows/poll.yml` — hourly cron + manual `workflow_dispatch`.
- `CNAME` — `blogwatch.dlqs.xyz`.

## Hosting
GitHub Pages, source = `main` branch root (legacy build — committing to `main`
redeploys). DNS: Porkbun `CNAME blogwatch → dlqs.github.io` (mirrors the other
`*.dlqs.xyz` project pages). Fully serverless — nothing runs on the devbox, so
**no dev port** is used.

## Add / remove a blog
Edit `blogs.json` and push. Omit `feed` to auto-discover it. For a truly
feed-less site, add a `scrape: { item, title, link, date }` selector block. The
next hourly run (or a manual `workflow_dispatch`) picks it up.

## Local dev
`npm install && node poll.mjs` regenerates `data.json`; then
`python3 -m http.server 8080` and open http://localhost:8080.
