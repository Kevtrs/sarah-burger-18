import {
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { appConfig, hasFirebaseConfig } from "./config";
import { ensureGuestAuth, hasKitchenAccess, signInKitchen, signOutKitchen, subscribeAuth } from "./auth";
import { requireFirebaseRuntime } from "./firebase";
import {
  archiveFirebaseSession,
  sessionId,
  sessionPath,
  subscribeConnection,
  subscribeSessionMeta,
} from "./session";

const LOCAL_EVENT = "sarah-burger-local-orders-changed";
const INVALID_FIREBASE_KEY = /[.#$[\]/]/;
const allowedToppings = ["pickles", "jalapenos", "onions"];
const allowedSauces = ["bigmac", "giant", "mayo", "ketchup", "spicy", "mustard"];
const allowedStatuses = ["received", "preparing", "ready", "served", "cancelled"];
const noSauceId = "none";

export function assertValidFirebaseKey(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    INVALID_FIREBASE_KEY.test(value)
  ) {
    throw new Error(`${label} invalide pour Firebase: ${JSON.stringify(value)}`);
  }
}

function assertSessionKey() {
  assertValidFirebaseKey(sessionId, "sessionId");
}

function cleanName(name) {
  return name.trim().replace(/\s+/g, " ").slice(0, 32);
}

function normalizeArray(value, allowedValues) {
  if (Array.isArray(value)) return value.filter((item) => allowedValues.includes(item));
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([key, selected]) => selected === true && allowedValues.includes(key))
      .map(([key]) => key);
  }
  return [];
}

function serializeToppings(value) {
  return normalizeArray(value, allowedToppings).reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {});
}

function normalizeSauces(value, legacySauce = "") {
  if (value && typeof value === "object" && !Array.isArray(value) && value[noSauceId] === true) {
    return [noSauceId];
  }

  if (Array.isArray(value) && value.includes(noSauceId)) return [noSauceId];
  if (value === noSauceId) return [noSauceId];

  const selected = normalizeArray(value, allowedSauces);
  if (selected.length) return selected;

  if (legacySauce === noSauceId) return [noSauceId];
  if (allowedSauces.includes(legacySauce)) return [legacySauce];
  return [];
}

function serializeSauces(value) {
  const selected = normalizeSauces(value);
  const ids = selected.length ? selected : [noSauceId];
  return ids.reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {});
}

function legacySauceValue(value) {
  const selected = normalizeSauces(value);
  return selected.includes(noSauceId) ? noSauceId : selected[0] || noSauceId;
}

export function normalizeOrder(data) {
  const sauces = normalizeSauces(data.sauces, data.sauce);
  return {
    id: data.id,
    sessionId: data.sessionId || sessionId,
    clientRequestId: data.clientRequestId || "",
    guestUid: data.guestUid || "",
    number: Number(data.number),
    guestName: data.guestName || "",
    toppings: normalizeArray(data.toppings, allowedToppings),
    sauce: data.sauce || legacySauceValue(sauces),
    sauces,
    status: allowedStatuses.includes(data.status) ? data.status : "received",
    createdAtMs: Number(data.createdAtMs || Date.now()),
    updatedAtMs: Number(data.updatedAtMs || data.createdAtMs || Date.now()),
  };
}

function sortOrders(orders) {
  return [...orders].sort((a, b) => a.number - b.number);
}

function normalizeClientRequestId(value) {
  if (typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value)) return value;
  return crypto.randomUUID?.() || `order-${Date.now()}`;
}

function createOrderPayload(input, number, user) {
  const now = Date.now();
  const clientRequestId = normalizeClientRequestId(input.clientRequestId);
  const sauces = serializeSauces(input.sauces);

  return {
    id: clientRequestId,
    sessionId,
    clientRequestId,
    guestUid: user?.uid || "local",
    number,
    guestName: cleanName(input.guestName),
    toppings: serializeToppings(input.toppings),
    sauce: legacySauceValue(sauces),
    sauces,
    status: "received",
    createdAtMs: now,
    updatedAtMs: now,
  };
}

async function assertFirebaseConnected(db) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Connexion indisponible. Réessaie quand le réseau revient.");
  }

  await new Promise((resolve, reject) => {
    const connectedRef = ref(db, ".info/connected");
    let unsubscribe;
    const timeout = window.setTimeout(() => {
      unsubscribe?.();
      reject(new Error("Firebase n'est pas joignable pour le moment."));
    }, 5000);

    unsubscribe = onValue(
      connectedRef,
      (snapshot) => {
        window.clearTimeout(timeout);
        unsubscribe?.();
        if (snapshot.val() === true) {
          resolve();
        } else {
          reject(new Error("Firebase n'est pas joignable pour le moment."));
        }
      },
      (error) => {
        window.clearTimeout(timeout);
        unsubscribe?.();
        reject(error);
      },
      { onlyOnce: true },
    );
  });
}

function makeFirebaseOrderStore() {
  return {
    mode: "firebase",

    subscribeAuth,
    signInKitchen,
    signOutKitchen,
    hasKitchenAccess,
    subscribeConnection,
    subscribeSessionMeta,

    async createOrder(input) {
      const user = await ensureGuestAuth();
      const { db } = requireFirebaseRuntime();
      await assertFirebaseConnected(db);

      const clientRequestId = normalizeClientRequestId(input.clientRequestId);
      const orderId = clientRequestId;
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      assertValidFirebaseKey(clientRequestId, "clientRequestId");

      const orderPath = sessionPath(`orders/${orderId}`);
      const orderRef = ref(db, orderPath);
      const existingOrder = await get(orderRef);

      if (existingOrder.exists()) {
        const existing = normalizeOrder(existingOrder.val());
        if (existing.guestUid === user.uid) return existing;
        throw new Error("Cette commande existe déjà pour un autre invité.");
      }

      const counterRef = ref(db, sessionPath("meta/lastNumber"));
      const counterResult = await runTransaction(
        counterRef,
        (current) => Number(current || appConfig.firstOrderNumber - 1) + 1,
        { applyLocally: false },
      );

      if (!counterResult.committed) {
        throw new Error("Impossible de réserver un numéro de commande.");
      }

      const number = Number(counterResult.snapshot.val());
      const optimisticPayload = createOrderPayload({ ...input, clientRequestId }, number, user);
      const serverPayload = {
        ...optimisticPayload,
        createdAtMs: serverTimestamp(),
        updatedAtMs: serverTimestamp(),
      };

      await set(orderRef, serverPayload);

      return normalizeOrder(optimisticPayload);
    },

    subscribeOrders(onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      const ordersRef = ref(db, sessionPath("orders"));
      const unsubscribe = onValue(
        ordersRef,
        (snapshot) => {
          const value = snapshot.val() || {};
          onChange(sortOrders(Object.values(value).map(normalizeOrder)));
        },
        onError,
      );

      return () => unsubscribe?.();
    },

    subscribeOrder(orderId, onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      const orderRef = ref(db, sessionPath(`orders/${orderId}`));
      const unsubscribe = onValue(
        orderRef,
        (snapshot) => {
          if (snapshot.exists()) onChange(normalizeOrder(snapshot.val()));
        },
        onError,
      );

      return () => unsubscribe?.();
    },

    subscribeOrderStatus(orderId, onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      const statusRef = ref(db, sessionPath(`orders/${orderId}/status`));
      const unsubscribe = onValue(
        statusRef,
        (snapshot) => {
          if (snapshot.exists()) onChange(snapshot.val());
        },
        onError,
      );

      return () => unsubscribe?.();
    },

    async updateStatus(orderId, status) {
      if (!allowedStatuses.includes(status)) throw new Error("Statut invalide.");
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      await update(ref(db, sessionPath(`orders/${orderId}`)), {
        status,
        updatedAtMs: serverTimestamp(),
      });
    },

    async archiveSession() {
      await archiveFirebaseSession();
    },
  };
}

function makeLocalStore() {
  const ordersKey = `sarah-burger:${sessionId}:orders`;
  const counterKey = `sarah-burger:${sessionId}:counter`;
  const archiveKey = `sarah-burger:${sessionId}:archived`;
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(ordersKey);

  function readOrders() {
    try {
      const value = localStorage.getItem(ordersKey);
      const parsed = value ? JSON.parse(value) : [];
      return sortOrders(parsed.map(normalizeOrder));
    } catch {
      return [];
    }
  }

  function writeOrders(orders) {
    localStorage.setItem(ordersKey, JSON.stringify(sortOrders(orders)));
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    channel?.postMessage("changed");
  }

  function nextNumber() {
    const current = Number(localStorage.getItem(counterKey) || appConfig.firstOrderNumber - 1);
    const next = current + 1;
    localStorage.setItem(counterKey, String(next));
    return next;
  }

  function subscribeLocal(onChange) {
    const handler = () => onChange(readOrders());
    window.addEventListener("storage", handler);
    window.addEventListener(LOCAL_EVENT, handler);
    channel?.addEventListener("message", handler);
    handler();

    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(LOCAL_EVENT, handler);
      channel?.removeEventListener("message", handler);
    };
  }

  function subscribeLocalConnection(onChange) {
    const handler = () => onChange(navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    handler();
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }

  return {
    mode: "local",

    subscribeAuth(onChange) {
      onChange({ uid: "local-kitchen", isAnonymous: false });
      return () => {};
    },

    async signInKitchen() {
      sessionStorage.setItem("sarah-burger-kitchen", "ok");
      return { uid: "local-kitchen" };
    },

    async signOutKitchen() {
      sessionStorage.removeItem("sarah-burger-kitchen");
    },

    async hasKitchenAccess() {
      return true;
    },

    subscribeConnection: subscribeLocalConnection,

    subscribeSessionMeta(onChange) {
      const handler = () => onChange({ archived: localStorage.getItem(archiveKey) === "yes" });
      window.addEventListener(LOCAL_EVENT, handler);
      handler();
      return () => window.removeEventListener(LOCAL_EVENT, handler);
    },

    async createOrder(input) {
      if (!navigator.onLine) throw new Error("Connexion indisponible. Réessaie quand le réseau revient.");
      if (localStorage.getItem(archiveKey) === "yes") {
        throw new Error("La session est archivée.");
      }

      const clientRequestId = normalizeClientRequestId(input.clientRequestId);
      const existing = readOrders().find((order) => order.clientRequestId === clientRequestId);
      if (existing) return existing;

      const order = {
        ...createOrderPayload({ ...input, clientRequestId }, nextNumber(), { uid: "local" }),
      };
      writeOrders([...readOrders(), order]);
      return normalizeOrder(order);
    },

    subscribeOrders(onChange) {
      return subscribeLocal(onChange);
    },

    subscribeOrder(orderId, onChange) {
      return subscribeLocal((orders) => {
        const order = orders.find((item) => item.id === orderId);
        if (order) onChange(order);
      });
    },

    subscribeOrderStatus(orderId, onChange) {
      return subscribeLocal((orders) => {
        const order = orders.find((item) => item.id === orderId);
        if (order) onChange(order.status);
      });
    },

    async updateStatus(orderId, status) {
      if (!allowedStatuses.includes(status)) throw new Error("Statut invalide.");
      const orders = readOrders().map((order) =>
        order.id === orderId
          ? { ...order, status, updatedAtMs: Date.now() }
          : order,
      );
      writeOrders(orders);
    },

    async archiveSession() {
      localStorage.setItem(archiveKey, "yes");
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    },
  };
}

export function createOrderStore() {
  return hasFirebaseConfig() ? makeFirebaseOrderStore() : makeLocalStore();
}
