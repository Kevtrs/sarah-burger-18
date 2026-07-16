import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { get, ref } from "firebase/database";
import { requireFirebaseRuntime } from "./firebase";

export function subscribeAuth(onChange, onError) {
  try {
    const { auth } = requireFirebaseRuntime();
    return onAuthStateChanged(auth, onChange, onError);
  } catch (err) {
    onError?.(err);
    return () => {};
  }
}

export async function ensureGuestAuth() {
  const { auth } = requireFirebaseRuntime();
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function signInKitchen(email, password) {
  const { auth, db } = requireFirebaseRuntime();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const kitchenAccess = await get(ref(db, `kitchenUsers/${credential.user.uid}`));

  if (kitchenAccess.val() !== true) {
    await signOut(auth);
    throw new Error("Ce compte n'est pas autorisé pour la cuisine.");
  }

  return credential.user;
}

export async function signOutKitchen() {
  const { auth } = requireFirebaseRuntime();
  await signOut(auth);
}

export async function hasKitchenAccess(uid) {
  if (!uid) return false;
  const { db } = requireFirebaseRuntime();
  const snapshot = await get(ref(db, `kitchenUsers/${uid}`));
  return snapshot.val() === true;
}

export async function requireKitchenUser() {
  const { auth } = requireFirebaseRuntime();
  const user = auth.currentUser;

  if (!user || user.isAnonymous) {
    throw new Error("Connecte-toi avec le compte cuisine.");
  }

  const allowed = await hasKitchenAccess(user.uid);
  if (!allowed) {
    throw new Error("Ce compte n'est pas autorisé pour la cuisine.");
  }

  return user;
}
