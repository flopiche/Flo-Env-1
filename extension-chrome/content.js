// Extraire le nom du vendeur depuis l'URL
function getVendorName() {
  const match = window.location.href.match(/vendeur=([^.&]+)/);
  if (!match) return null;
  return match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Extraire le nombre de produits depuis le HTML
function getProductCount() {
  const span = document.querySelector('span.productcount strong');
  if (!span) return null;
  const count = parseInt(span.textContent.trim(), 10);
  return isNaN(count) ? null : count;
}

// Envoyer les données au storage
function saveData() {
  const vendor = getVendorName();
  const count = getProductCount();
  if (!vendor || count === null) return;

  const today = new Date().toISOString().split('T')[0];

  chrome.storage.local.get(['vendors'], (result) => {
    const vendors = result.vendors || {};
    if (!vendors[vendor]) vendors[vendor] = {};

    // Ne pas écraser si déjà enregistré aujourd'hui
    if (!vendors[vendor][today]) {
      vendors[vendor][today] = count;
      chrome.storage.local.set({ vendors });
    }
  });
}

saveData();
