// firebase-messaging-sw.js
// Service Worker do Firebase Cloud Messaging
// Fica na raiz do projeto para capturar notificacoes em background (PWA/web)

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

// Manipula mensagens recebidas em background
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Mensagem em background recebida:', payload);

  const notificationTitle = (payload.notification && payload.notification.title)
    ? payload.notification.title
    : 'Elgaly Express';

  const notificationOptions = {
    body: (payload.notification && payload.notification.body)
      ? payload.notification.body
      : 'Voce tem uma nova notificacao EEX!',
    icon: '/images/icon-192.png',
    badge: '/images/icon-192.png',
    tag: payload.data ? payload.data.type : 'eex-notif',
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Click na notificacao: abre o app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url && clientList[i].focus) {
          return clientList[i].focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
