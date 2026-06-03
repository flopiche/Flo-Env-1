function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function renderTable(vendors) {
  const tbody = document.getElementById('tableBody');
  const today = getToday();
  const yesterday = getYesterday();

  const rows = Object.entries(vendors);
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">Aucune donnée — visitez une page vendeur.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(([vendor, dates]) => {
    const countToday = dates[today] ?? null;
    const countYesterday = dates[yesterday] ?? null;

    let evoBadge = '<span class="badge same">—</span>';
    if (countToday !== null && countYesterday !== null && countYesterday !== 0) {
      const pct = ((countToday - countYesterday) / countYesterday * 100).toFixed(1);
      const sign = pct > 0 ? '+' : '';
      const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
      evoBadge = `<span class="badge ${cls}">${sign}${pct}%</span>`;
    }

    return `
      <tr>
        <td><strong>${vendor}</strong></td>
        <td>${formatDate(yesterday)}</td>
        <td>${countYesterday !== null ? countYesterday : '<span style="color:#999">—</span>'}</td>
        <td>${formatDate(today)}</td>
        <td>${countToday !== null ? countToday : '<span style="color:#999">—</span>'}</td>
        <td>${evoBadge}</td>
      </tr>`;
  }).join('');
}

chrome.storage.local.get(['vendors'], (result) => {
  renderTable(result.vendors || {});
});

document.getElementById('btnClear').addEventListener('click', () => {
  if (confirm('Effacer toutes les données ?')) {
    chrome.storage.local.remove('vendors', () => renderTable({}));
  }
});
