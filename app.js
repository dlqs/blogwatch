// blogwatch UI — one row per blog (favicon + latest post), newest first.
// Visited posts dim via the CSS :visited selector; no per-post "new" badge.

async function main() {
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('list');

  let data;
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    statusEl.textContent = 'could not load data.json';
    return;
  }

  const blogs = data.blogs || [];
  statusEl.innerHTML =
    `Watching <strong>${blogs.length}</strong> blog${blogs.length === 1 ? '' : 's'}` +
    (data.generatedAt ? ` · updated ${fmtUpdated(data.generatedAt)}` : '');

  const broken = blogs.filter((b) => !b.ok);
  if (broken.length) {
    const details = document.getElementById('issues');
    details.hidden = false;
    details.querySelector('summary').textContent =
      `${broken.length} blog${broken.length === 1 ? '' : 's'} could not be checked`;
    document.getElementById('issues-list').innerHTML =
      broken.map((b) => `<li>${esc(b.name)} — ${esc(b.error || 'error')}</li>`).join('');
  }

  const now = Date.now();
  const rows = blogs
    .filter((b) => b.latest)
    .map((b) => ({ ...b, _t: Date.parse(b.latest.published || b.latest.firstSeen) || 0 }))
    .sort((a, b) => b._t - a._t);

  if (!rows.length) {
    listEl.innerHTML = '<p class="muted empty">No posts yet.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const b of rows) frag.appendChild(renderRow(b, now));
  listEl.appendChild(frag);
}

function renderRow(b, now) {
  const li = document.createElement('li');
  li.className = 'row';

  li.appendChild(favicon(b));

  const a = document.createElement('a');
  a.className = 'title';
  a.href = b.latest.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = b.latest.title || '(untitled)';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const blog = document.createElement('span');
  blog.className = 'blog';
  blog.textContent = b.name;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtWhen(b.latest.published, b._t, now);
  meta.append(blog, time);

  const body = document.createElement('div');
  body.className = 'body';
  body.append(a, meta);
  li.appendChild(body);
  return li;
}

function favicon(b) {
  if (b.icon) {
    const img = document.createElement('img');
    img.className = 'favicon';
    img.src = b.icon;
    img.alt = '';
    img.width = 16;
    img.height = 16;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(placeholder(b.name)));
    return img;
  }
  return placeholder(b.name);
}

function placeholder(name) {
  const span = document.createElement('span');
  span.className = 'favicon placeholder';
  span.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return span;
}

// Real date when we have one; for dateless sources say when blogwatch first
// found it, so the label never pretends to be a publish date.
function fmtWhen(published, t, now) {
  return published ? relTime(t, now) : `found ${relTime(t, now)}`;
}

function relTime(t, now) {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function fmtUpdated(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();
