import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { appConfig, hasFirebaseConfig } from "./config";
import { getFirebaseRuntime } from "./firebase";

let supportPromise = null;
let registrationPromise = null;
let messagingInstance = null;

function basePath() {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

function serviceWorkerUrl() {
  return new URL(`${basePath()}firebase-messaging-sw.js`, window.location.href).href;
}

function serviceWorkerScope() {
  return new URL(basePath(), window.location.href).pathname;
}

export function detectPushEnvironment() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      canRequest: false,
      isIos: false,
      isStandalone: false,
      notificationSupported: false,
      serviceWorkerSupported: false,
      secureContext: false,
      reason: "Notifications indisponibles dans cet environnement.",
    };
  }

  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  const notificationSupported = "Notification" in window;
  const serviceWorkerSupported = "serviceWorker" in navigator;
  const secureContext = window.isSecureContext === true;
  const hasConfig = hasFirebaseConfig() && Boolean(appConfig.vapidKey);
  const iosNeedsInstall = isIos && !isStandalone;

  let reason = "";
  if (!hasConfig) reason = "Les notifications push ne sont pas encore configurées.";
  else if (!secureContext) reason = "Les notifications push demandent HTTPS.";
  else if (!notificationSupported) reason = "Ce navigateur ne gère pas les notifications.";
  else if (!serviceWorkerSupported) reason = "Ce navigateur ne gère pas le service worker.";
  else if (iosNeedsInstall) reason = "Sur iPhone, installe d'abord Sarah Burger sur l'écran d'accueil.";

  return {
    canRequest: hasConfig && secureContext && notificationSupported && serviceWorkerSupported && !iosNeedsInstall,
    isIos,
    isStandalone,
    notificationSupported,
    serviceWorkerSupported,
    secureContext,
    reason,
  };
}

export async function isFirebaseMessagingSupported() {
  if (!supportPromise) {
    supportPromise = isSupported().catch(() => false);
  }
  return supportPromise;
}

export async function getMessagingAvailability() {
  const environment = detectPushEnvironment();
  if (!environment.canRequest) return { ...environment, supported: false };

  const supported = await isFirebaseMessagingSupported();
  return {
    ...environment,
    supported,
    reason: supported ? "" : "Firebase Messaging n'est pas disponible sur ce navigateur.",
  };
}

export async function registerMessagingServiceWorker() {
  const environment = detectPushEnvironment();
  if (!environment.canRequest) throw new Error(environment.reason);

  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register(serviceWorkerUrl(), {
      scope: serviceWorkerScope(),
    });
  }

  return registrationPromise;
}

async function getMessagingInstance() {
  const availability = await getMessagingAvailability();
  if (!availability.supported) throw new Error(availability.reason);

  const runtime = getFirebaseRuntime();
  if (!runtime) throw new Error("Firebase n'est pas configuré.");

  if (!messagingInstance) messagingInstance = getMessaging(runtime.app);
  return messagingInstance;
}

export async function requestFcmToken() {
  const availability = await getMessagingAvailability();
  if (!availability.supported) throw new Error(availability.reason);

  if (window.Notification.permission === "denied") {
    throw new Error("Les notifications sont bloquées dans les réglages du navigateur.");
  }

  let permission = window.Notification.permission;
  if (permission === "default") {
    permission = await window.Notification.requestPermission();
  }

  if (permission !== "granted") {
    throw new Error("Garde cette page ouverte pour être averti.");
  }

  const serviceWorkerRegistration = await registerMessagingServiceWorker();
  const messaging = await getMessagingInstance();
  const token = await getToken(messaging, {
    vapidKey: appConfig.vapidKey,
    serviceWorkerRegistration,
  });

  if (!token) {
    throw new Error("Le navigateur n'a pas fourni de token push.");
  }

  return { permission, serviceWorkerRegistration, token };
}

export async function subscribeForegroundMessages(onReadyMessage) {
  const availability = await getMessagingAvailability();
  if (!availability.supported) return () => {};

  const messaging = await getMessagingInstance();
  return onMessage(messaging, (payload) => {
    const data = payload.data || {};
    if (data.type !== "order-ready") return;
    onReadyMessage({ data, payload });
  });
}
