const SEUIL_BAISSE = 15; // % de baisse pour déclencher une alerte

chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
});

function setupAlarms() {
  // Rappel quotidien à 9h30
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const next930 = new Date(now);
  next930.setHours(9, 30, 0, 0);
  if (next930 <= now) next930.setDate(next930.getDate() + 1);
  chrome.alarms.create('daily-reminder', { when: next930.getTime() - 2 * 60 * 60 * 1000 });

  // Vérification horaire des baisses
  chrome.alarms.create('hourly-check', { periodInMinutes: 60 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily-reminder') {
    chrome.notifications.create('reminder', {
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'El Carlitator',
      message: "Coucou, n'oublie pas de me lancer ! 👋",
      priority: 2
    });
    // Replanifie pour demain
    const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 30, 0, 0);
    chrome.alarms.create('daily-reminder', { when: next.getTime() - 2 * 60 * 60 * 1000 });
  }

  if (alarm.name === 'hourly-check') {
    runHourlyCheck();
  }
});

async function fetchCount(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/class="productcount"[^>]*>\s*<strong>\s*(\d+)\s*<\/strong>/);
    if (!match) return 0; // page accessible mais vendeur disparu
    const count = parseInt(match[1], 10);
    return isNaN(count) ? 0 : count;
  } catch (e) {
    return null;
  }
}

function getNowKey() {
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 19);
}

function getLatestKey(dates) {
  return Object.keys(dates).sort().at(-1) ?? null;
}

async function runHourlyCheck() {
  const stored = await chrome.storage.local.get(['vendors', 'vendorUrls']);
  const vendorUrls = stored.vendorUrls || [];
  const vendors = stored.vendors || {};

  if (vendorUrls.length === 0) return;

  const nowKey = getNowKey();
  const baisses = [];

  for (const url of vendorUrls) {
    const match = url.match(/vendeur=([^.&/]+)/);
    if (!match) continue;
    const vendor = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const count = await fetchCount(url);
    if (count === null) continue;

    // Comparer avec la dernière valeur connue
    const dates = vendors[vendor] || {};
    const lastKey = getLatestKey(dates);
    const lastCount = lastKey ? dates[lastKey] : null;

    // Sauvegarder le nouveau count
    if (!vendors[vendor]) vendors[vendor] = {};
    vendors[vendor][nowKey] = count;

    // Vérifier la baisse
    if (lastCount !== null && lastCount > 0) {
      const pct = ((count - lastCount) / lastCount) * 100;
      if (pct <= -SEUIL_BAISSE) {
        baisses.push({ vendor, lastCount, count, pct: pct.toFixed(1) });
      }
    }
  }

  await chrome.storage.local.set({ vendors });

  const disparus = [];
  for (const url of vendorUrls) {
    const match = url.match(/vendeur=([^.&/]+)/);
    if (!match) continue;
    const vendor = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const dates = vendors[vendor] || {};
    const lastKey = getLatestKey(dates);
    const lastCount = lastKey ? dates[lastKey] : null;
    if (lastCount === 0 && Object.keys(dates).length >= 2) {
      const prevKey = Object.keys(dates).sort().at(-2);
      if (prevKey && dates[prevKey] > 0) disparus.push(vendor);
    }
  }

  if (disparus.length > 0) {
    chrome.notifications.create('disparu-alert', {
      type: 'basic',
      iconUrl: 'icon48.png',
      title: `⚠️ El Carlitator — ${disparus.length} vendeur(s) disparu(s)`,
      message: disparus.join(', '),
      priority: 2
    });
  }

  if (baisses.length > 0) {
    const message = baisses
      .map(b => `${b.vendor} : ${b.lastCount} → ${b.count} (${b.pct}%)`)
      .join('\n');

    chrome.notifications.create('baisse-alert', {
      type: 'basic',
      iconUrl: 'icon48.png',
      title: `📉 El Carlitator — ${baisses.length} baisse(s) détectée(s)`,
      message,
      priority: 2
    });
  }
}
