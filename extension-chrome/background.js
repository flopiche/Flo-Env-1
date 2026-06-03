chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily-reminder') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'El Carlitator',
      message: "Coucou, n'oublie pas de me lancer ! 👋",
      priority: 2
    });
    scheduleAlarm(); // replanifie pour le lendemain
  }
});

function scheduleAlarm() {
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000); // GMT+2
  const next = new Date(now);
  next.setHours(9, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1); // si 9h30 déjà passé, demain

  // Reconvertir en UTC pour l'alarm
  const whenUTC = next.getTime() - 2 * 60 * 60 * 1000;
  chrome.alarms.create('daily-reminder', { when: whenUTC });
}
