chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
});

function setupAlarms() {
  // Rappel quotidien à 10h30
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const next1030 = new Date(now);
  next1030.setHours(10, 30, 0, 0);
  if (next1030 <= now) next1030.setDate(next1030.getDate() + 1);
  chrome.alarms.create('daily-reminder', { when: next1030.getTime() - 2 * 60 * 60 * 1000 });
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
    next.setHours(10, 30, 0, 0);
    chrome.alarms.create('daily-reminder', { when: next.getTime() - 2 * 60 * 60 * 1000 });
  }
});
