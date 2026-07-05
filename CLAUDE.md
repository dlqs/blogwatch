# blogwatch

Personal "new post" watcher for a hand-picked list of blogs, live at
https://blogwatch.dlqs.xyz. Static site on GitHub Pages; an hourly GitHub Action
polls each blog's feed and commits `data.json`. Links out to the original posts
only — it never mirrors content.

## Layout
- `blogs.json` — the watchlist (edit this). `{ name, url, feed?, scrape? }`.
- `poll.mjs` — resolves each feed (explicit `feed` → `<link rel=alternate>`
  discovery → common paths like `/feed`, `/atom.xml`), parses with `rss-parser`,
  and records the **single latest post per blog** — newest by `published` date,
  falling back to `firstSeen` for dateless sources. A blog with no feed carries a
  `scrape` block `{ item, title?, link?, date?, include?, exclude?, limit? }`
  (see Paul Graham, whose `articles.html` is a flat undated essay list). Node 20;
  deps: rss-parser, cheerio.
  Also self-hosts each blog's favicon into `icons/<host>.<ext>` (downloaded once,
  reused after).
- `index.html` + `app.js` + `styles.css` — vanilla one-row-per-blog UI (no build).
  Read posts dim via CSS `:visited` (no per-post badge). GoatCounter analytics at
  `blogwatch.goatcounter.com` (its own site code, separate from dlqs's).
- `data.json` — generated output, committed by CI. `{ generatedAt, blogs:[{…,
  icon, latest}], seen:{url→firstSeen} }`. `generatedAt` only advances when the
  content actually changes, so steady-state runs make no commit.
- `icons/` — self-hosted favicons committed by CI.
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
