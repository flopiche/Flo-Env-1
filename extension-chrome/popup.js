const MARKETPLACE_URL = 'https://www.vertbaudet.fr/shop/marketplace/';

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

function updateVendorCountLabel(urls) {
  document.getElementById('vendorCount').textContent =
    urls.length > 0 ? `${urls.length} vendeur(s) dans la liste` : '';
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

function discoverVendorUrls() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !tab.url.includes('vertbaudet.fr')) {
        reject(new Error('Ouvrez la page marketplace Vertbaudet d\'abord.'));
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => {
            const spans = document.querySelectorAll('span.qtetooltip.encoded-url[data-url]');
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
          }
        },
        (results) => {
          if (chrome.runtime.lastError || !results || !results[0]) {
            reject(new Error('Impossible de lire la page.'));
          } else {
            resolve(results[0].result);
          }
        }
      );
    });
  });
}

// Init : charger les données stockées
chrome.storage.local.get(['vendors', 'vendorUrls'], (result) => {
  renderTable(result.vendors || {});
  updateVendorCountLabel(result.vendorUrls || []);
});

// Découvrir les vendeurs automatiquement
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

// Compter les produits pour tous les vendeurs
document.getElementById('btnCount').addEventListener('click', async () => {
  const btn = document.getElementById('btnCount');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = '';

  chrome.storage.local.get(['vendors', 'vendorUrls'], async (stored) => {
    const vendorUrls = stored.vendorUrls || VENDOR_URLS || [];

    if (vendorUrls.length === 0) {
      status.textContent = '⚠️ Aucune URL — cliquez d\'abord sur "Découvrir les vendeurs".';
      btn.disabled = false;
      btn.textContent = '▶ Compter maintenant';
      return;
    }

    const today = getToday();
    const results = [];

    for (let i = 0; i < vendorUrls.length; i++) {
      const url = vendorUrls[i];
      const vendor = extractVendorName(url);
      if (!vendor) continue;

      btn.textContent = `⏳ ${i + 1}/${vendorUrls.length} — ${vendor}…`;

      try {
        const count = await fetchProductCount(url);
        results.push({ vendor, count, ok: count !== null });
      } catch (e) {
        results.push({ vendor, count: null, ok: false });
      }
    }

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
        status.textContent = `✅ ${saved} enregistrés. ❌ Erreurs : ${errors.join(', ')}`;
      } else {
        status.textContent = `✅ ${saved} vendeur(s) mis à jour.`;
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
