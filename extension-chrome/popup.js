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

function extractVendorName(url) {
  const match = url.match(/vendeur=([^.&/]+)/);
  if (!match) return null;
  return match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderTable(vendors) {
  const tbody = document.getElementById('tableBody');
  const today = getToday();
  const yesterday = getYesterday();

  const rows = Object.entries(vendors);
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">Aucune donnée — cliquez sur "Compter maintenant".</td></tr>';
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

async function fetchProductCount(url) {
  const response = await fetch(url);
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const strong = doc.querySelector('span.productcount strong');
  if (!strong) return null;
  const count = parseInt(strong.textContent.trim(), 10);
  return isNaN(count) ? null : count;
}

chrome.storage.local.get(['vendors'], (result) => {
  renderTable(result.vendors || {});
});

document.getElementById('btnCount').addEventListener('click', async () => {
  const btn = document.getElementById('btnCount');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = '';

  const today = getToday();
  const results = [];

  for (let i = 0; i < VENDOR_URLS.length; i++) {
    const url = VENDOR_URLS[i];
    const vendor = extractVendorName(url);
    if (!vendor) continue;

    btn.textContent = `⏳ ${i + 1}/${VENDOR_URLS.length} — ${vendor}…`;

    try {
      const count = await fetchProductCount(url);
      results.push({ vendor, count, ok: count !== null });
    } catch (e) {
      results.push({ vendor, count: null, ok: false });
    }
  }

  chrome.storage.local.get(['vendors'], (stored) => {
    const vendors = stored.vendors || {};
    let saved = 0;
    for (const { vendor, count, ok } of results) {
      if (ok) {
        if (!vendors[vendor]) vendors[vendor] = {};
        vendors[vendor][today] = count;
        saved++;
      }
    }
    chrome.storage.local.set({ vendors }, () => {
      renderTable(vendors);
      const errors = results.filter(r => !r.ok).map(r => r.vendor);
      if (errors.length > 0) {
        status.textContent = `✅ ${saved} vendeur(s) enregistrés. ❌ Erreur : ${errors.join(', ')}`;
      } else {
        status.textContent = `✅ ${saved} vendeur(s) mis à jour avec succès.`;
      }
      btn.disabled = false;
      btn.textContent = '▶ Compter maintenant';
    });
  });
});

document.getElementById('btnClear').addEventListener('click', () => {
  if (confirm('Effacer toutes les données ?')) {
    chrome.storage.local.remove('vendors', () => renderTable({}));
  }
});
