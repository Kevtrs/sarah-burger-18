import { onValue, ref, serverTimestamp, update } from "firebase/database";
import { appConfig } from "./config";
import { ensureGuestAuth, requireKitchenUser } from "./auth";
import { requireFirebaseRuntime } from "./firebase";

export const sessionId = appConfig.eventId;
const INVALID_FIREBASE_KEY = /[.#$[\]/]/;

function assertSafePathSegment(value, label) {
  if (typeof value !== "string" || value.length < 1 || INVALID_FIREBASE_KEY.test(value)) {
    throw new Error(`${label} invalide pour Firebase.`);
  }
}

export function sessionPath(path = "") {
  return `sessions/${sessionId}${path ? `/${path}` : ""}`;
}

export function normalizeSessionMeta(value = {}) {
  const unavailable = value.unavailable && typeof value.unavailable === "object" ? value.unavailable : {};

  return {
    archived: value.archived === true,
    paused: value.paused === true,
    unavailable: {
      toppings:
        unavailable.toppings && typeof unavailable.toppings === "object"
          ? unavailable.toppings
          : {},
      sauces:
        unavailable.sauces && typeof unavailable.sauces === "object"
          ? unavailable.sauces
          : {},
      extras:
        unavailable.extras && typeof unavailable.extras === "object"
          ? unavailable.extras
          : {},
    },
  };
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
    const metaRefs = [
      { key: "archived", target: ref(db, sessionPath("meta/archived")) },
      { key: "paused", target: ref(db, sessionPath("meta/paused")) },
      { key: "unavailable", target: ref(db, sessionPath("meta/unavailable")) },
    ];
    let cancelled = false;
    const unsubscribers = [];
    const partial = {};

    function emit() {
      onChange(normalizeSessionMeta(partial));
    }

    ensureGuestAuth()
      .then(() => {
        if (cancelled) return;
        for (const item of metaRefs) {
          unsubscribers.push(
            onValue(
              item.target,
              (snapshot) => {
                partial[item.key] = snapshot.val();
                emit();
              },
              onError,
            ),
          );
        }
      })
      .catch(onError);

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
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

export async function setFirebaseSessionPaused(paused) {
  const user = await requireKitchenUser();
  const { db } = requireFirebaseRuntime();
  await update(ref(db, sessionPath("meta")), {
    paused: paused === true,
    pausedAtMs: serverTimestamp(),
    pausedBy: user.uid,
    updatedAtMs: serverTimestamp(),
  });
}

export async function setFirebaseUnavailableItem(group, id, unavailable) {
  assertSafePathSegment(group, "groupe");
  assertSafePathSegment(id, "ingredient");

  const user = await requireKitchenUser();
  const { db } = requireFirebaseRuntime();
  await update(ref(db, sessionPath("meta")), {
    [`unavailable/${group}/${id}`]: unavailable === true,
    availabilityUpdatedAtMs: serverTimestamp(),
    availabilityUpdatedBy: user.uid,
    updatedAtMs: serverTimestamp(),
  });
}
