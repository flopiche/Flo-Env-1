const MARKETPLACE_URL = 'https://www.vertbaudet.fr/shop/marketplace.htm';
const BATCH_SIZE = 10; // requêtes simultanées

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// Retourne la dernière date connue avant aujourd'hui
function getLastKnownDate(dates, today) {
  return Object.keys(dates)
    .filter(d => d < today)
    .sort()
    .at(-1) ?? null;
}

function extractVendorName(url) {
  const match = url.match(/vendeur=([^.&/]+)/);
  if (!match) return null;
  return match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderTable(vendors) {
  const tbody = document.getElementById('tableBody');
  const today = getToday();

  const rows = Object.entries(vendors);
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">Aucune donnée — cliquez sur "Compter maintenant".</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(([vendor, dates]) => {
    const countToday = dates[today] ?? null;
    const lastDate = getLastKnownDate(dates, today);
    const countLast = lastDate ? dates[lastDate] : null;

    const lastCell = countLast !== null
      ? `${countLast} <span style="color:#aaa;font-size:11px">(${formatDate(lastDate)})</span>`
      : '<span style="color:#999">—</span>';

    let evoBadge = '<span class="badge same">—</span>';
    if (countToday !== null && countLast !== null && countLast !== 0) {
      const pct = ((countToday - countLast) / countLast * 100).toFixed(1);
      const sign = pct > 0 ? '+' : '';
      const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
      evoBadge = `<span class="badge ${cls}">${sign}${pct}%</span>`;
    }

    return `
      <tr>
        <td><strong>${vendor}</strong></td>
        <td>${lastCell}</td>
        <td>${formatDate(today)}</td>
        <td>${countToday !== null ? countToday : '<span style="color:#999">—</span>'}</td>
        <td>${evoBadge}</td>
      </tr>`;
  }).join('');
}

function updateVendorCountLabel(urls) {
  document.getElementById('vendorCount').textContent =
    urls.length > 0 ? `${urls.length} vendeur(s) dans la liste` : '';
}

async function fetchProductCount(url) {
  const response = await fetch(url);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const strong = doc.querySelector('span.productcount strong');
  if (!strong) return null;
  const count = parseInt(strong.textContent.trim(), 10);
  return isNaN(count) ? null : count;
}

async function discoverVendorUrls() {
  const response = await fetch(MARKETPLACE_URL);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const urls = [];
  doc.querySelectorAll('li[class*=" v_"] span.encoded-url[data-url]').forEach(span => {
    try {
      const decoded = decodeURIComponent(atob(span.dataset.url));
      if (decoded.includes('vendeur=')) {
        urls.push('https://www.vertbaudet.fr' + decoded);
      }
    } catch (e) {}
  });

  return [...new Set(urls)];
}

// Exécute les promesses par batch de taille N
async function batchAll(items, batchSize, asyncFn, onProgress) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(asyncFn));
    results.push(...batchResults);
    if (onProgress) onProgress(results.length, items.length);
  }
  return results;
}

// Init
chrome.storage.local.get(['vendors', 'vendorUrls'], (result) => {
  renderTable(result.vendors || {});
  updateVendorCountLabel(result.vendorUrls || []);
});

// Découvrir les vendeurs
document.getElementById('btnDiscover').addEventListener('click', async () => {
  const btn = document.getElementById('btnDiscover');
  const status = document.getElementById('status');
  btn.disabled = true;
  btn.textContent = '⏳ Recherche…';
  status.textContent = '';

  try {
    const urls = await discoverVendorUrls();
    if (urls.length === 0) {
      status.textContent = '❌ Aucun vendeur trouvé sur la page marketplace.';
    } else {
      chrome.storage.local.set({ vendorUrls: urls }, () => {
        updateVendorCountLabel(urls);
        status.textContent = `✅ ${urls.length} vendeur(s) découvert(s) et enregistrés.`;
      });
    }
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
  }

  btn.disabled = false;
  btn.textContent = '🔍 Découvrir les vendeurs';
});

// Compter les produits — requêtes parallèles par batch
document.getElementById('btnCount').addEventListener('click', async () => {
  const btn = document.getElementById('btnCount');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = '';

  chrome.storage.local.get(['vendors', 'vendorUrls'], async (stored) => {
    const vendorUrls = stored.vendorUrls || [];

    if (vendorUrls.length === 0) {
      status.textContent = '⚠️ Aucune URL — cliquez d\'abord sur "Découvrir les vendeurs".';
      btn.disabled = false;
      btn.textContent = '▶ Compter maintenant';
      return;
    }

    const today = getToday();
    btn.textContent = `⏳ 0/${vendorUrls.length}…`;

    const results = await batchAll(
      vendorUrls,
      BATCH_SIZE,
      async (url) => {
        const vendor = extractVendorName(url);
        try {
          const count = await fetchProductCount(url);
          return { vendor, count, ok: count !== null };
        } catch (e) {
          return { vendor, count: null, ok: false };
        }
      },
      (done, total) => {
        btn.textContent = `⏳ ${done}/${total}…`;
      }
    );

    const vendors = stored.vendors || {};
    let saved = 0;
    for (const { vendor, count, ok } of results) {
      if (!vendor) continue;
      if (ok) {
        if (!vendors[vendor]) vendors[vendor] = {};
        vendors[vendor][today] = count;
        saved++;
      }
    }

    chrome.storage.local.set({ vendors }, () => {
      renderTable(vendors);
      const errors = results.filter(r => !r.ok && r.vendor).map(r => r.vendor);
      status.textContent = errors.length > 0
        ? `✅ ${saved} enregistrés. ❌ Erreurs (${errors.length}) : ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '…' : ''}`
        : `✅ ${saved} vendeur(s) mis à jour.`;
      btn.disabled = false;
      btn.textContent = '▶ Compter maintenant';
    });
  });
});

document.getElementById('btnExport').addEventListener('click', () => {
  chrome.storage.local.get(['vendors'], (stored) => {
    const vendors = stored.vendors || {};
    const today = getToday();
    const rows = Object.entries(vendors);

    if (rows.length === 0) {
      document.getElementById('status').textContent = '⚠️ Aucune donnée à exporter.';
      return;
    }

    // Génère un tableau HTML qu'Excel ouvre nativement en XLS
    const tableRows = rows.map(([vendor, dates]) => {
      const countToday = dates[today] ?? '';
      const lastDate = getLastKnownDate(dates, today);
      const countLast = lastDate ? dates[lastDate] : '';
      let pct = '';
      if (countToday !== '' && countLast !== '' && countLast !== 0) {
        pct = ((countToday - countLast) / countLast * 100).toFixed(1);
      }
      return `<tr>
        <td>${vendor}</td>
        <td>${lastDate ? formatDate(lastDate) : ''}</td>
        <td>${countLast}</td>
        <td>${formatDate(today)}</td>
        <td>${countToday}</td>
        <td>${pct !== '' ? pct + '%' : ''}</td>
      </tr>`;
    }).join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:x="urn:schemas-microsoft-com:office:excel"
            xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
          <x:ExcelWorksheet><x:Name>Vendeurs</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
          </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      </head>
      <body><table>
        <tr>
          <th>Vendeur</th>
          <th>Dernière exécution (date)</th>
          <th>Nb dernière exécution</th>
          <th>Aujourd'hui (date)</th>
          <th>Nb aujourd'hui</th>
          <th>Évolution %</th>
        </tr>
        ${tableRows}
      </table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = today.replace(/-/g, '');
    a.href = url;
    a.download = `vendeurs_${dateStr}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById('status').textContent = `✅ Export téléchargé (${rows.length} vendeurs).`;
  });
});

document.getElementById('btnClear').addEventListener('click', () => {
  if (confirm('Effacer toutes les données ?')) {
    chrome.storage.local.remove('vendors', () => renderTable({}));
  }
});
