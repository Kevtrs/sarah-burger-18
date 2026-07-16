const rawConfig = typeof window === "undefined" ? {} : window.SARAH_BURGER_CONFIG ?? {};
const env = import.meta.env;

function valueFrom(rawValue, envValue, fallback = "") {
  return rawValue || envValue || fallback;
}

const firebaseConfig = {
  apiKey: valueFrom(rawConfig.firebaseConfig?.apiKey, env.VITE_FIREBASE_API_KEY),
  authDomain: valueFrom(rawConfig.firebaseConfig?.authDomain, env.VITE_FIREBASE_AUTH_DOMAIN),
  databaseURL: valueFrom(rawConfig.firebaseConfig?.databaseURL, env.VITE_FIREBASE_DATABASE_URL),
  projectId: valueFrom(rawConfig.firebaseConfig?.projectId, env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: valueFrom(rawConfig.firebaseConfig?.storageBucket, env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: valueFrom(
    rawConfig.firebaseConfig?.messagingSenderId,
    env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: valueFrom(rawConfig.firebaseConfig?.appId, env.VITE_FIREBASE_APP_ID),
};

export const appConfig = {
  eventId: valueFrom(rawConfig.eventId, env.VITE_EVENT_ID, "sarah-18-2026"),
  eventName: valueFrom(rawConfig.eventName, env.VITE_EVENT_NAME, "18 ans de Sarah"),
  firstOrderNumber: Number(valueFrom(rawConfig.firstOrderNumber, env.VITE_FIRST_ORDER_NUMBER, 18)),
  repositoryName: valueFrom(rawConfig.repositoryName, env.VITE_GITHUB_PAGES_REPO),
  firebaseConfig,
};

export function hasFirebaseConfig() {
  const config = appConfig.firebaseConfig;
  return Boolean(config.apiKey && config.projectId && config.appId && config.databaseURL);
}
