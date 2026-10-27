// firebase-messaging-sw.js
// service worker do FCM — fica na raiz pra capturar notifs em background (PWA/web)

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCqiHc-EI3HKK557PXiVHoiqbZ6hPFGMws",
  authDomain: "elgaly-express-230108.firebaseapp.com",
  projectId: "elgaly-express-230108",
  storageBucket: "elgaly-express-230108.firebasestorage.app",
  messagingSenderId: "1008407071059",
  appId: "1:1008407071059:web:d42e1754bad1257a6bb9a6"
});

const messaging = firebase.messaging();

// trata mensagens recebidas em background
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Mensagem em background recebida:', payload);

  const notificationTitle = (payload.notification && payload.notification.title)
    ? payload.notification.title
    : 'Elgaly Express';

  const notifType = (payload.data && payload.data.type) ? payload.data.type : 'eex-notif';
  const isChat = notifType === 'eex_mail';

  const notificationOptions = {
    body: (payload.notification && payload.notification.body)
      ? payload.notification.body
      : 'Voce tem uma nova notificacao EEX!',
    icon: '/images/icon-192.png',
    badge: '/images/icon-192.png',
    tag: isChat ? ('eex-chat-' + (payload.data.chatId || 'msg')) : notifType,
    data: payload.data || {},
    vibrate: [250, 100, 250, 100, 250],
    requireInteraction: false,
    actions: isChat ? [
      { action: 'chat', title: '💬 Responder no Chat' },
      { action: 'dismiss', title: 'Dispensar' }
    ] : [
      { action: 'open',    title: '⚡ Ver Rotina' },
      { action: 'dismiss', title: 'Dispensar' }
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// click na notificacao: abre o app (ou foca se ja estiver aberto)
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const action = event.action;
  if (action === 'dismiss') return;

  const notifData = event.notification.data || {};
  const targetUrl = (notifData.type === 'eex_mail') ? '/#amigos' : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url && clientList[i].focus) {
          if (notifData.type === 'eex_mail' && clientList[i].navigate) {
            clientList[i].navigate(targetUrl);
          }
          return clientList[i].focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
