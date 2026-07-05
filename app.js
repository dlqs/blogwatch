// blogwatch UI — fetches data.json and renders a unified, reverse-chron timeline.

const NEW_WINDOW_MS = 48 * 3600 * 1000;

async function main() {
  const statusEl = document.getElementById('status');
  const timelineEl = document.getElementById('timeline');

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
  const posts = data.posts || [];

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

  if (!posts.length) {
    timelineEl.innerHTML = '<p class="muted empty">No posts yet.</p>';
    return;
  }

  const now = Date.now();
  const groups = new Map();
  for (const p of posts) {
    const t = Date.parse(p.published || p.firstSeen) || now;
    const key = dayKey(new Date(t));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...p, _t: t });
  }

  const frag = document.createDocumentFragment();
  for (const items of groups.values()) {
    const h = document.createElement('h2');
    h.className = 'day';
    h.textContent = dayLabel(new Date(items[0]._t));
    frag.appendChild(h);

    const ul = document.createElement('ul');
    ul.className = 'posts';
    for (const p of items) ul.appendChild(renderPost(p, now));
    frag.appendChild(ul);
  }
  timelineEl.appendChild(frag);
}

function renderPost(p, now) {
  const li = document.createElement('li');
  li.className = 'post';

  const titleRow = document.createElement('div');
  titleRow.className = 'title-row';

  const a = document.createElement('a');
  a.className = 'title';
  a.href = p.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = p.title || '(untitled)';
  titleRow.appendChild(a);

  if (p.firstSeen && now - Date.parse(p.firstSeen) < NEW_WINDOW_MS) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'NEW';
    titleRow.appendChild(badge);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const blog = document.createElement('span');
  blog.className = 'blog';
  blog.textContent = p.blog;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = relTime(p._t, now);
  meta.append(blog, time);

  li.append(titleRow, meta);
  return li;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function dayLabel(d) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
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
