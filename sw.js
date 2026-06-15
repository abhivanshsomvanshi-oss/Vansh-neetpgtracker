// MedTracker Pro — Service Worker v2.0
// Reliable background notifications for Android Chrome PWA

const CACHE_NAME = 'medtracker-v2';
const DB_NAME = 'medtracker-sw-db';
const DB_VERSION = 1;

// ── IndexedDB helpers (SW ke andar localStorage nahi hota) ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function dbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key, value });
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {}
}

// ── INSTALL ──
self.addEventListener('install', e => {
  console.log('[SW] Installed');
  self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  console.log('[SW] Activated');
  e.waitUntil(
    clients.claim().then(() => {
      scheduleNextCheck();
    })
  );
});

// ── MESSAGE from app → save settings to IndexedDB ──
self.addEventListener('message', async e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_UPDATE') {
    await dbSet('wakeHour', e.data.wakeHour ?? 8);
    await dbSet('sleepHour', e.data.sleepHour ?? 1);
    await dbSet('notifEnabled', e.data.notifEnabled ?? true);
    await dbSet('cheatDays', e.data.cheatDays ?? {});
    console.log('[SW] Settings saved to IndexedDB');

    // Confirm back to app
    const clientList = await clients.matchAll({ type: 'window' });
    clientList.forEach(c => c.postMessage({ type: 'SW_READY' }));
  }
});

// ── MAIN SCHEDULER ──
// setTimeout chain — fires every minute, checks if notification needed
async function scheduleNextCheck() {
  // Wait till next full minute
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 1000;

  setTimeout(async () => {
    await checkAndNotify();
    scheduleNextCheck(); // chain next check
  }, msToNextMinute);
}

async function checkAndNotify() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  // Only fire in first 3 minutes of each hour
  if (m > 3) return;

  const wakeHour = (await dbGet('wakeHour')) ?? 8;
  const sleepHour = (await dbGet('sleepHour')) ?? 1;
  const notifEnabled = (await dbGet('notifEnabled')) ?? true;
  const cheatDays = (await dbGet('cheatDays')) ?? {};
  const lastFired = (await dbGet('lastFiredHour')) ?? -1;

  if (!notifEnabled) return;

  // Cheat day check
  const today = now.toISOString().split('T')[0];
  if (cheatDays[today]) return;

  // Same hour already fired?
  if (h === lastFired) return;

  // Active time check (supports overnight e.g. wake 8, sleep 1AM)
  const isActive = sleepHour < wakeHour
    ? (h >= wakeHour || h < sleepHour)   // overnight
    : (h >= wakeHour && h < sleepHour);  // same day

  if (!isActive) return;

  // Mark as fired
  await dbSet('lastFiredHour', h);

  // Is app open & visible?
  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const appVisible = clientList.some(c => c.visibilityState === 'visible');
  if (appVisible) return; // App khuli hai — woh khud popup dikhayega

  // Show notification — PREVIOUS hour slot
  const prevH = (h - 1 + 24) % 24;
  const label =
    String(prevH).padStart(2, '0') + ':00 – ' +
    String(h).padStart(2, '0') + ':00';

  self.registration.showNotification('⏰ ' + label + ' | MedTracker', {
    body: 'Kya kiya is ghante? Tap karo aur fill karo! 📝',
    icon: '/Vansh-neetpgtracker/icon-192.png',
    badge: '/Vansh-neetpgtracker/icon-192.png',
    tag: 'hourly-log',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 400],
    silent: false,
    data: { hour: prevH, url: '/Vansh-neetpgtracker/' }
  });
}

// ── NOTIFICATION CLICK → open app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // App already open? Focus karo
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      // Nahi toh kholo
      return clients.openWindow('/Vansh-neetpgtracker/');
    })
  );
});
