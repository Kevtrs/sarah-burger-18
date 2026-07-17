import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadEnv } from "vite";

const cwd = process.cwd();
const mode = process.env.MODE || process.env.NODE_ENV || "development";
const env = { ...loadEnv(mode, cwd, ""), ...process.env };

function envValue(key) {
  return env[key] || "";
}

const firebaseConfig = {
  apiKey: envValue("VITE_FIREBASE_API_KEY"),
  authDomain: envValue("VITE_FIREBASE_AUTH_DOMAIN"),
  databaseURL: envValue("VITE_FIREBASE_DATABASE_URL"),
  projectId: envValue("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: envValue("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: envValue("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: envValue("VITE_FIREBASE_APP_ID"),
};

const requiredFirebaseKeys = ["apiKey", "projectId", "appId", "messagingSenderId"];
const hasFirebaseConfig = requiredFirebaseKeys.every((key) => Boolean(firebaseConfig[key]));
const publicSiteUrl = envValue("VITE_PUBLIC_SITE_URL");
const sdkVersion = envValue("VITE_FIREBASE_JS_SDK_VERSION") || "11.1.0";

const swSource = `/* global importScripts, firebase, clients */
const FIREBASE_CONFIG = ${JSON.stringify(firebaseConfig, null, 2)};
const HAS_FIREBASE_CONFIG = ${JSON.stringify(hasFirebaseConfig)};
const FIREBASE_SDK_VERSION = ${JSON.stringify(sdkVersion)};
const PUBLIC_SITE_URL = ${JSON.stringify(publicSiteUrl)};
const APP_URL = PUBLIC_SITE_URL || self.registration.scope;
const ICON_URL = new URL("assets/sarah-logo.svg", self.registration.scope).href;

function notificationBody(data) {
  const orderNumber = data.orderNumber ? \`#\${data.orderNumber}\` : "";
  return data.body || \`Commande \${orderNumber} — viens la récupérer au stand Sarah Burger.\`;
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
  importScripts(\`https://www.gstatic.com/firebasejs/\${FIREBASE_SDK_VERSION}/firebase-app-compat.js\`);
  importScripts(\`https://www.gstatic.com/firebasejs/\${FIREBASE_SDK_VERSION}/firebase-messaging-compat.js\`);

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
      tag: data.tag || \`sarah-burger-ready-\${orderId}\`,
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
`;

const outputPath = path.join(cwd, "public", "firebase-messaging-sw.js");
fs.writeFileSync(outputPath, swSource);
console.log(
  `Generated public/firebase-messaging-sw.js (${hasFirebaseConfig ? "Firebase enabled" : "Firebase disabled"})`,
);
