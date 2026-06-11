const MARKETPLACE_URL = 'https://www.vertbaudet.fr/shop/marketplace.htm';
const BATCH_SIZE = 10; // requêtes simultanées

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// Clé unique par exécution en GMT+2 : "2026-06-03T14:32"
function getNowKey() {
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 16);
}

// Retourne l'avant-dernière date connue (toutes dates confondues)
function getLastKnownDate(dates, today) {
  const sorted = Object.keys(dates).sort();
  // Si on a une valeur aujourd'hui, on prend l'entrée juste avant
  // Sinon on prend la dernière connue
  if (dates[today] !== undefined && sorted.length >= 2) {
    return sorted.at(-2);
  }
  if (dates[today] === undefined && sorted.length >= 1) {
    return sorted.at(-1);
  }
  return null;
}

function extractVendorName(url) {
  const match = url.match(/vendeur=([^.&/]+)/);
  if (!match) return null;
  return match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getLatestKey(dates) {
  return Object.keys(dates).sort().at(-1) ?? null;
}

function renderTable(vendors) {
  const tbody = document.getElementById('tableBody');
  const today = getToday();

  const rows = Object.entries(vendors);
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="no-data">Aucune donnée — cliquez sur "Compter maintenant".</td></tr>';
    return;
  }

  let totalLast = 0;
  let totalLatest = 0;

  const rowsHtml = rows.map(([vendor, dates]) => {
    // Dernière exécution = la plus récente
    const latestKey = getLatestKey(dates);
    const countToday = latestKey ? dates[latestKey] : null;
    const lastDate = getLastKnownDate(dates, latestKey);
    const countLast = lastDate ? dates[lastDate] : null;

    if (countLast !== null) totalLast += countLast;
    if (countToday !== null) totalLatest += countToday;

    const lastCell = countLast !== null
      ? `${countLast} <span style="color:#aaa;font-size:11px">(${lastDate.slice(0,10).split('-').reverse().join('/')} ${lastDate.slice(11,16)})</span>`
      : '<span style="color:#999">—</span>';

    const todayCell = countToday !== null
      ? `${countToday} <span style="color:#aaa;font-size:11px">(${latestKey.slice(0,10).split('-').reverse().join('/')} ${latestKey.slice(11,16)})</span>`
      : '<span style="color:#999">—</span>';

    let evoBadge = '<span class="badge same">—</span>';
    if (countToday === 0 && countLast > 0) {
      evoBadge = '<span class="badge down">⚠️ Disparu</span>';
    } else if (countToday !== null && countLast !== null && countLast !== 0) {
      const pct = ((countToday - countLast) / countLast * 100).toFixed(1);
      const sign = pct > 0 ? '+' : '';
      const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
      evoBadge = `<span class="badge ${cls}">${sign}${pct}%</span>`;
    }

    return `
      <tr>
        <td><strong>${vendor}</strong></td>
        <td>${lastCell}</td>
        <td>${todayCell}</td>
        <td>${evoBadge}</td>
      </tr>`;
  }).join('');

  let totalEvoBadge = '<span class="badge same">—</span>';
  if (totalLast > 0) {
    const totalPct = ((totalLatest - totalLast) / totalLast * 100).toFixed(1);
    const sign = totalPct > 0 ? '+' : '';
    const cls = totalPct > 0 ? 'up' : totalPct < 0 ? 'down' : 'same';
    totalEvoBadge = `<span class="badge ${cls}">${sign}${totalPct}%</span>`;
  }

  tbody.innerHTML = rowsHtml + `
    <tr class="total-row">
      <td><strong>TOTAL</strong></td>
      <td><strong>${totalLast}</strong></td>
      <td><strong>${totalLatest}</strong></td>
      <td>${totalEvoBadge}</td>
    </tr>`;
}

function updateVendorCountLabel(urls) {
  document.getElementById('vendorCount').textContent =
    urls.length > 0 ? `${urls.length} vendeur(s) dans la liste` : '';
}

async function fetchProductCount(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null; // erreur réseau
    const html = await response.text();
    const match = html.match(/class="productcount"[^>]*>\s*<strong>\s*(\d+)\s*<\/strong>/);
    if (!match) return 0; // page accessible mais 0 produit ou vendeur disparu
    const count = parseInt(match[1], 10);
    return isNaN(count) ? 0 : count;
  } catch (e) {
    return null; // erreur réseau, on ignore
  }
}

function discoverVendorUrls() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !tab.url.includes('vertbaudet.fr/shop/marketplace')) {
        reject(new Error('Ouvrez d\'abord la page marketplace Vertbaudet dans cet onglet.'));
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => {
            return new Promise((resolve) => {
              const extract = () => {
                const spans = document.querySelectorAll('li[class*=" v_"] span[data-url]');
                if (spans.length === 0) return null;
                const urls = [];
                spans.forEach(span => {
                  try {
                    const decoded = decodeURIComponent(atob(span.dataset.url));
                    if (decoded.includes('vendeur=')) {
                      urls.push('https://www.vertbaudet.fr' + decoded);
                    }
                  } catch (e) {}
                });
                return [...new Set(urls)];
              };

              let elapsed = 0;
              const interval = setInterval(() => {
                const result = extract();
                elapsed += 500;
                if (result && result.length > 0) {
                  clearInterval(interval);
                  resolve(result);
                } else if (elapsed >= 10000) {
                  clearInterval(interval);
                  resolve([]);
                }
              }, 500);
            });
          }
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            reject(new Error('Impossible de lire la page.'));
          } else {
            resolve(results[0].result);
          }
        }
      );
    });
  });
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
    const nowKey = getNowKey();
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
        vendors[vendor][nowKey] = count;
        saved++;
      }
    }

    chrome.storage.local.set({ vendors }, () => {
      renderTable(vendors);
      const errors = results.filter(r => !r.ok && r.vendor).map(r => r.vendor);
      const disparus = results.filter(r => r.count === 0 && r.vendor).map(r => r.vendor);
      let msg = `✅ ${saved} vendeur(s) mis à jour.`;
      if (disparus.length > 0) msg += ` ⚠️ Disparu(s) : ${disparus.join(', ')}`;
      if (errors.length > 0) msg += ` ❌ Erreurs (${errors.length})`;
      status.textContent = msg;
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
      const latestKey = getLatestKey(dates);
      const countLatest = latestKey ? dates[latestKey] : '';
      const prevKey = getLastKnownDate(dates, latestKey);
      const countPrev = prevKey ? dates[prevKey] : '';
      let pct = '';
      if (countLatest !== '' && countPrev !== '' && countPrev !== 0) {
        pct = ((countLatest - countPrev) / countPrev * 100).toFixed(1);
      }
      const fmtKey = k => k ? `${k.slice(0,10).split('-').reverse().join('/')} ${k.slice(11,16)}` : '';
      return `<tr>
        <td>${vendor}</td>
        <td>${fmtKey(prevKey)}</td>
        <td>${countPrev}</td>
        <td>${fmtKey(latestKey)}</td>
        <td>${countLatest}</td>
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
          <th>Avant-dernière exécution (date)</th>
          <th>Nb avant-dernière</th>
          <th>Dernière exécution (date)</th>
          <th>Nb dernière</th>
          <th>Évolution %</th>
        </tr>
        ${tableRows}
      </table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateStr = today.replace(/-/g, '');
    chrome.downloads.download(
      { url, filename: `vendeurs_${dateStr}.xls`, saveAs: false },
      () => { URL.revokeObjectURL(url); }
    );
    document.getElementById('status').textContent = `✅ Export téléchargé (${rows.length} vendeurs).`;
  });
});

document.getElementById('btnClear').addEventListener('click', () => {
  if (confirm('Effacer toutes les données ?')) {
    chrome.storage.local.remove('vendors', () => renderTable({}));
  }
});
