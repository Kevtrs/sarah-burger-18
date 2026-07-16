import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { appConfig, hasFirebaseConfig } from "./config";

const appName = "sarah-burger-18";
let firebaseRuntime = null;

export function getFirebaseRuntime() {
  if (!hasFirebaseConfig()) return null;
  if (firebaseRuntime) return firebaseRuntime;

  const existingApp = getApps().find((app) => app.name === appName);
  const app = existingApp || initializeApp(appConfig.firebaseConfig, appName);

  firebaseRuntime = {
    app,
    auth: getAuth(app),
    db: getDatabase(app),
  };

  return firebaseRuntime;
}

export function requireFirebaseRuntime() {
  const runtime = getFirebaseRuntime();
  if (!runtime) {
    throw new Error("Firebase n'est pas configuré.");
  }
  return runtime;
}
