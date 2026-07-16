import { onValue, ref, serverTimestamp, update } from "firebase/database";
import { appConfig } from "./config";
import { ensureGuestAuth, requireKitchenUser } from "./auth";
import { requireFirebaseRuntime } from "./firebase";

export const sessionId = appConfig.eventId;

export function sessionPath(path = "") {
  return `sessions/${sessionId}${path ? `/${path}` : ""}`;
}

export function subscribeConnection(onChange) {
  try {
    const { db } = requireFirebaseRuntime();
    const connectedRef = ref(db, ".info/connected");
    const unsubscribe = onValue(connectedRef, (snapshot) => {
      onChange(Boolean(snapshot.val()));
    });
    return () => unsubscribe();
  } catch {
    const handler = () => onChange(navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    handler();
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }
}

export function subscribeSessionMeta(onChange, onError) {
  try {
    const { db } = requireFirebaseRuntime();
    const archivedRef = ref(db, sessionPath("meta/archived"));
    let cancelled = false;
    let unsubscribe;

    ensureGuestAuth()
      .then(() => {
        if (cancelled) return;
        unsubscribe = onValue(
          archivedRef,
          (snapshot) => onChange({ archived: snapshot.val() === true }),
          onError,
        );
      })
      .catch(onError);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  } catch (err) {
    onError?.(err);
    return () => {};
  }
}

export async function archiveFirebaseSession() {
  const user = await requireKitchenUser();
  const { db } = requireFirebaseRuntime();
  await update(ref(db, sessionPath("meta")), {
    archived: true,
    archivedAtMs: serverTimestamp(),
    archivedBy: user.uid,
    updatedAtMs: serverTimestamp(),
  });
}
