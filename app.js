// blogwatch UI — one row per blog showing its latest post, newest first.

const NEW_WINDOW_MS = 48 * 3600 * 1000;

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

  const head = document.createElement('div');
  head.className = 'row-head';
  head.appendChild(a);
  if (b.latest.firstSeen && now - Date.parse(b.latest.firstSeen) < NEW_WINDOW_MS) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'NEW';
    head.appendChild(badge);
  }

  li.append(head, meta);
  return li;
}

// Show a real date when we have one; for dateless sources fall back to
// "seen Nd ago" so the label never lies about a publish date.
function fmtWhen(published, t, now) {
  if (published) return relTime(t, now);
  return `seen ${relTime(t, now)}`;
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
