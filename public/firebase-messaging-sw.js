/* global importScripts, firebase, clients */
const FIREBASE_CONFIG = {
  "apiKey": "",
  "authDomain": "",
  "databaseURL": "",
  "projectId": "",
  "storageBucket": "",
  "messagingSenderId": "",
  "appId": ""
};
const HAS_FIREBASE_CONFIG = false;
const FIREBASE_SDK_VERSION = "11.1.0";
const PUBLIC_SITE_URL = "";
const APP_URL = PUBLIC_SITE_URL || self.registration.scope;
const ICON_URL = new URL("assets/sarah-logo.svg", self.registration.scope).href;

function notificationBody(data) {
  const orderNumber = data.orderNumber ? `#${data.orderNumber}` : "";
  return data.body || `Commande ${orderNumber} — viens la récupérer au stand Sarah Burger.`;
}

function notificationUrl(data) {
  const target = new URL(data.url || APP_URL, self.location.origin);
  if (data.orderId) target.searchParams.set("readyOrder", data.orderId);
  target.hash = "commande";
  return target.href;
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const url = notificationUrl(data);
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const appClient = clientList.find((client) => client.url.startsWith(self.registration.scope));
      if (appClient) {
        appClient.focus();
        appClient.postMessage({
          type: "order-ready-notification-click",
          orderId: data.orderId || "",
          orderNumber: data.orderNumber || "",
        });
        return undefined;
      }

      return clients.openWindow(url);
    }),
  );
});

if (HAS_FIREBASE_CONFIG) {
  importScripts(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`);
  importScripts(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-messaging-compat.js`);

  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    if (data.type !== "order-ready") return;

    const title = data.title || "Ton burger est prêt 🍔";
    const orderId = data.orderId || "unknown";

    self.registration.showNotification(title, {
      body: notificationBody(data),
      icon: data.icon || ICON_URL,
      badge: data.badge || ICON_URL,
      tag: data.tag || `sarah-burger-ready-${orderId}`,
      renotify: false,
      requireInteraction: false,
      data: {
        orderId,
        orderNumber: data.orderNumber || "",
        type: "order-ready",
        url: notificationUrl(data),
      },
    });
  });
} else {
  console.info("Sarah Burger FCM service worker generated without Firebase config.");
}
