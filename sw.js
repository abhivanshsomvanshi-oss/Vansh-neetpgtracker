// MedTracker Pro — Service Worker v1.0
// GitHub Pages pe index.html ke saath same folder mein rakhna

const SW_VERSION = 'medtracker-v1';

// ── INSTALL & ACTIVATE ──
self.addEventListener('install', e => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activated');
  e.waitUntil(clients.claim());
  startHourlyCheck();
});

// ── SCHEDULE STORAGE (IndexedDB via SW memory + message) ──
// App se message aata hai wake time ke saath
self.wakeHour = 8;   // default
self.sleepHour = 1;  // default 1AM (next day)
self.notifEnabled = true;
self.lastFiredHour = -1;
self.cheatDays = {};

self.addEventListener('message', e => {
  if(!e.data) return;

  if(e.data.type === 'SCHEDULE_UPDATE') {
    self.wakeHour = e.data.wakeHour ?? self.wakeHour;
    self.sleepHour = e.data.sleepHour ?? self.sleepHour;
    self.notifEnabled = e.data.notifEnabled ?? self.notifEnabled;
    self.cheatDays = e.data.cheatDays ?? self.cheatDays;
    console.log('[SW] Schedule updated:', self.wakeHour, '→', self.sleepHour);
  }

  if(e.data.type === 'CHEAT_DAY') {
    self.cheatDays = e.data.cheatDays ?? self.cheatDays;
    console.log('[SW] Cheat days updated');
  }
});

// ── HOURLY CHECK LOOP ──
let _timer = null;
function startHourlyCheck() {
  if(_timer) clearInterval(_timer);

  // Check every minute
  _timer = setInterval(() => {
    if(!self.notifEnabled) return;

    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const today = now.toISOString().split('T')[0];

    // Cheat day check
    if(self.cheatDays && self.cheatDays[today]) return;

    // Only fire in first 5 minutes of each hour
    if(m > 5) return;

    // Don't fire same hour twice
    if(h === self.lastFiredHour) return;

    // Sleep time check
    // wakeHour e.g. 8, sleepHour e.g. 1 (means 1AM next day)
    const wakeH = self.wakeHour;
    const sleepH = self.sleepHour;

    let isActiveTime = false;
    if(wakeH < sleepH) {
      // Normal: e.g. wake 8, sleep 22
      isActiveTime = h >= wakeH && h < sleepH;
    } else {
      // Overnight: e.g. wake 8, sleep 1 (past midnight)
      isActiveTime = h >= wakeH || h < sleepH;
    }

    if(!isActiveTime) return;

    // Fire notification — show PREVIOUS hour slot
    self.lastFiredHour = h;
    const prevH = (h - 1 + 24) % 24;
    const label =
      String(prevH).padStart(2, '0') + ':00 – ' +
      String(h).padStart(2, '0') + ':00';

    // Check if app is open & visible — skip if yes (app handles popup itself)
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const appVisible = clientList.some(c => c.visibilityState === 'visible');
      if(appVisible) return; // App khuli hai, woh khud handle karega

      // App band hai — SW notification bhejo
      self.registration.showNotification('⏰ ' + label + ' — MedTracker', {
        body: 'Is ghante mein kya kiya? Tap karo aur fill karo! 📝',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'hourly-log',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        data: {
          hour: prevH,
          url: '/?hour=' + prevH
        },
        actions: [
          { action: 'fill', title: '📝 Fill Karo' },
          { action: 'skip', title: '⏭ Skip' }
        ]
      });
    });

  }, 60000); // har 60 seconds check
}

// ── MIDNIGHT REMINDER — kal ka wake time set karo ──
setInterval(() => {
  const now = new Date();
  if(now.getHours() === 23 && now.getMinutes() >= 50) {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const appVisible = clientList.some(c => c.visibilityState === 'visible');
      if(appVisible) return;

      self.registration.showNotification('🩺 MedTracker — Kal ka plan?', {
        body: 'Kal ka wake-up time set karo! Tap karo.',
        icon: '/icon-192.png',
        tag: 'midnight-reminder',
        requireInteraction: true,
        vibrate: [300, 150, 300],
        data: { url: '/?tab=settings' }
      });
    });
  }
}, 60000);

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const url = (e.notification.data && e.notification.data.url) || '/';
  const action = e.action;

  if(action === 'skip') return; // Skip — kuch mat karo

  // Fill karo ya tap kiya — app kholo
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Agar app already khuli hai toh focus karo
      for(const client of clientList) {
        if('focus' in client) return client.focus();
      }
      // Nahi toh naya window kholo
      return self.clients.openWindow(url);
    })
  );
});

// ── NOTIFICATION CLOSE ──
self.addEventListener('notificationclose', e => {
  console.log('[SW] Notification closed:', e.notification.tag);
});
