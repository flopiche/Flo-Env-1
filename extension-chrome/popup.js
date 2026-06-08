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

  tbody.innerHTML = rows.map(([vendor, dates]) => {
    // Dernière exécution = la plus récente
    const latestKey = getLatestKey(dates);
    const countToday = latestKey ? dates[latestKey] : null;
    const lastDate = getLastKnownDate(dates, latestKey);
    const countLast = lastDate ? dates[lastDate] : null;

    const lastCell = countLast !== null
      ? `${countLast} <span style="color:#aaa;font-size:11px">(${lastDate.slice(0,10).split('-').reverse().join('/')} ${lastDate.slice(11,16)})</span>`
      : '<span style="color:#999">—</span>';

    const todayCell = countToday !== null
      ? `${countToday} <span style="color:#aaa;font-size:11px">(${latestKey.slice(0,10).split('-').reverse().join('/')} ${latestKey.slice(11,16)})</span>`
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
        <td>${todayCell}</td>
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
  const match = html.match(/class="productcount"[^>]*>\s*<strong>\s*(\d+)\s*<\/strong>/);
  if (!match) return null;
  const count = parseInt(match[1], 10);
  return isNaN(count) ? null : count;
}

function discoverVendorUrls() {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: MARKETPLACE_URL, active: false }, (tab) => {
      const tabId = tab.id;

      function onUpdated(updatedTabId, info) {
        if (updatedTabId !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);

        setTimeout(() => {
          chrome.scripting.executeScript(
            {
              target: { tabId },
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

                  // Polling toutes les 500ms, max 15 secondes
                  let elapsed = 0;
                  const interval = setInterval(() => {
                    const result = extract();
                    elapsed += 500;
                    if (result && result.length > 0) {
                      clearInterval(interval);
                      resolve(result);
                    } else if (elapsed >= 15000) {
                      clearInterval(interval);
                      resolve([]);
                    }
                  }, 500);
                });
              }
            },
            (results) => {
              chrome.tabs.remove(tabId);
              if (chrome.runtime.lastError || !results?.[0]) {
                reject(new Error('Impossible d\'extraire les vendeurs.'));
              } else {
                resolve(results[0].result);
              }
            }
          );
        }, 3000);
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
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
