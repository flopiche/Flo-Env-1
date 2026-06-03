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

document.getElementById('btnCount').addEventListener('click', () => {
  const btn = document.getElementById('btnCount');
  const status = document.getElementById('status');
  btn.disabled = true;
  btn.textContent = '⏳ Comptage…';
  status.textContent = '';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes('vertbaudet.fr/shop/marketplace')) {
      status.textContent = '⚠️ Ouvrez une page vendeur Vertbaudet d\'abord.';
      btn.disabled = false;
      btn.textContent = '▶ Compter maintenant';
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
          const vendorMatch = window.location.href.match(/vendeur=([^.&]+)/);
          const strongEl = document.querySelector('span.productcount strong');
          return {
            vendor: vendorMatch ? vendorMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null,
            count: strongEl ? parseInt(strongEl.textContent.trim(), 10) : null
          };
        }
      },
      (results) => {
        if (chrome.runtime.lastError || !results || !results[0]) {
          status.textContent = '❌ Impossible de lire la page.';
          btn.disabled = false;
          btn.textContent = '▶ Compter maintenant';
          return;
        }

        const { vendor, count } = results[0].result;
        if (!vendor || count === null || isNaN(count)) {
          status.textContent = '❌ Aucun compteur trouvé sur cette page.';
          btn.disabled = false;
          btn.textContent = '▶ Compter maintenant';
          return;
        }

        const today = new Date().toISOString().split('T')[0];
        chrome.storage.local.get(['vendors'], (result) => {
          const vendors = result.vendors || {};
          if (!vendors[vendor]) vendors[vendor] = {};
          vendors[vendor][today] = count;
          chrome.storage.local.set({ vendors }, () => {
            renderTable(vendors);
            status.textContent = `✅ ${vendor} — ${count} produits enregistrés.`;
            btn.disabled = false;
            btn.textContent = '▶ Compter maintenant';
          });
        });
      }
    );
  });
});

document.getElementById('btnClear').addEventListener('click', () => {
  if (confirm('Effacer toutes les données ?')) {
    chrome.storage.local.remove('vendors', () => renderTable({}));
  }
});
