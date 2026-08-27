const api = (path, options = {}) => fetch(`/admin/api/${path}`, {
  headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  ...options
}).then(async (response) => {
  if (!response.ok) throw new Error((await response.json().catch(() => ({ error: response.statusText }))).error);
  return response.status === 204 ? null : response.json();
});

const button = (text, action, className = '') => {
  const element = document.createElement('button');
  element.textContent = text;
  element.className = className;
  element.onclick = action;
  return element;
};

const formatBytes = (bytes) => {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length);
  return `${(bytes / 1000 ** unit).toFixed(1)} ${units[unit - 1]}`;
};

let entryPage = 1;

async function refresh() {
  const [summary, tokens, admins, entries] = await Promise.all([
    api('summary'), api('tokens'), api('admins'), api(`entries?page=${entryPage}`)
  ]);
  entryPage = entries.page;

  document.querySelector('#summary').innerHTML = [
    ['Storage', formatBytes(summary.bytes)],
    ['Entries', summary.entries],
    ['Eviction', `${summary.pruneAfterDays} days`]
  ].map(([label, value]) => `<div class="card"><small>${label}</small><h2>${value}</h2></div>`).join('');
  document.querySelector('#activity').innerHTML = summary.audit.map((item) => `<li>${item.action}: ${item.detail} <small>${new Date(item.at).toLocaleString()}</small></li>`).join('') || '<li>No activity yet</li>';

  const rows = (target, items, render) => {
    document.querySelector(target).replaceChildren(...items.map(render));
  };
  rows('#token-list', tokens, (token) => {
    const row = document.createElement('div');
    row.textContent = `${token.label} (${token.prefix}...) ${token.revokedAt ? 'revoked' : 'active'}`;
    if (!token.revokedAt) row.append(' ', button('Rotate', async () => show(await api(`tokens/${token.id}/rotate`, { method: 'POST' }))), button('Revoke', async () => { await api(`tokens/${token.id}`, { method: 'DELETE' }); refresh(); }));
    return row;
  });
  rows('#admin-list', admins, (email) => {
    const row = document.createElement('div');
    row.textContent = email;
    row.append(' ', button('Remove', async () => { await api(`admins/${encodeURIComponent(email)}`, { method: 'DELETE' }); refresh(); }));
    return row;
  });
  rows('#entry-list', entries.items, (entry) => {
    const row = document.createElement('tr');
    const values = [entry.hash, formatBytes(entry.size), new Date(entry.createdAt).toLocaleString(), new Date(entry.lastAccessedAt).toLocaleString(), entry.accessCount ?? 0];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const action = document.createElement('td');
    action.className = 'action-column';
    action.append(button('Delete', async () => { await api(`entries/${entry.hash}`, { method: 'DELETE' }); await refresh(); }, 'danger subtle'));
    row.append(action);
    return row;
  });

  document.querySelector('#entry-count').textContent = `${entries.total} ${entries.total === 1 ? 'entry' : 'entries'}, 15 per page`;
  const pagination = document.querySelector('#entry-pagination');
  pagination.replaceChildren(
    button('Previous', async () => { entryPage -= 1; await refresh(); }),
    Object.assign(document.createElement('span'), { textContent: `Page ${entries.page} of ${entries.totalPages}` }),
    button('Next', async () => { entryPage += 1; await refresh(); })
  );
  pagination.firstElementChild.disabled = entries.page === 1;
  pagination.lastElementChild.disabled = entries.page === entries.totalPages;
}

function show(data) {
  const element = document.querySelector('#reveal');
  element.hidden = false;
  element.textContent = `Copy this token now. It will not be shown again:\n${data.token}`;
  refresh();
}

document.querySelector('#token-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  show(await api('tokens', { method: 'POST', body: JSON.stringify({ label: form.get('label'), permission: form.get('permission') }) }));
  event.target.reset();
};
document.querySelector('#admin-form').onsubmit = async (event) => {
  event.preventDefault();
  await api('admins', { method: 'POST', body: JSON.stringify({ email: new FormData(event.target).get('email') }) });
  event.target.reset();
  refresh();
};
document.querySelector('#clear-cache').onclick = async () => {
  if (!confirm('Delete every cache entry? This cannot be undone.')) return;
  const { deleted } = await api('entries', { method: 'DELETE' });
  entryPage = 1;
  await refresh();
  alert(`Deleted ${deleted} cache ${deleted === 1 ? 'entry' : 'entries'}.`);
};

refresh().catch((error) => alert(error.message));
