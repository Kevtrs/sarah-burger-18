import {
  get,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { appConfig, hasFirebaseConfig } from "./config";
import {
  ensureGuestAuth,
  hasKitchenAccess,
  requireKitchenUser,
  signInKitchen,
  signOutKitchen,
  subscribeAuth,
} from "./auth";
import { requireFirebaseRuntime } from "./firebase";
import {
  archiveFirebaseSession,
  normalizeSessionMeta,
  sessionId,
  sessionPath,
  setFirebaseSessionPaused,
  setFirebaseUnavailableItem,
  subscribeConnection,
  subscribeSessionMeta,
} from "./session";

const LOCAL_EVENT = "sarah-burger-local-orders-changed";
const INVALID_FIREBASE_KEY = /[.#$[\]/]/;
const allowedToppings = ["pickles", "jalapenos", "onions", "bacon"];
const allowedSauces = ["bigmac", "giant", "mayo", "ketchup", "spicy", "mustard"];
const allowedStatuses = ["received", "preparing", "ready", "served", "cancelled"];
const allowedUnavailable = {
  toppings: allowedToppings,
  sauces: allowedSauces,
  extras: ["nachos"],
};
const noSauceId = "none";
const itemLabels = {
  pickles: "Cornichons",
  jalapenos: "Jalapenos",
  onions: "Oignons frits",
  bacon: "Bacon",
  bigmac: "Big Mac maison",
  giant: "Giant maison",
  mayo: "Mayonnaise",
  ketchup: "Ketchup",
  spicy: "Sauce piquante",
  mustard: "Moutarde",
  nachos: "Nachos au cheddar",
};

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

function cleanMessageText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 180);
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
    nachos: data.nachos === true,
    status: allowedStatuses.includes(data.status) ? data.status : "received",
    createdAtMs: Number(data.createdAtMs || Date.now()),
    updatedAtMs: Number(data.updatedAtMs || data.createdAtMs || Date.now()),
  };
}

function sortOrders(orders) {
  return [...orders].sort((a, b) => a.number - b.number);
}

export function normalizeQueueEntry(data) {
  return {
    id: data.id || "",
    sessionId: data.sessionId || sessionId,
    number: Number(data.number),
    status: allowedStatuses.includes(data.status) ? data.status : "received",
    createdAtMs: Number(data.createdAtMs || Date.now()),
    updatedAtMs: Number(data.updatedAtMs || data.createdAtMs || Date.now()),
  };
}

function queueEntryFromOrder(order, overrides = {}) {
  const normalized = normalizeOrder(order);

  return normalizeQueueEntry({
    id: normalized.id,
    sessionId,
    number: normalized.number,
    status: normalized.status,
    createdAtMs: normalized.createdAtMs,
    updatedAtMs: normalized.updatedAtMs,
    ...overrides,
  });
}

function sortQueueEntries(entries) {
  return [...entries].sort((a, b) => a.number - b.number);
}

export function normalizePickupAck(data) {
  return {
    id: data.id || data.orderId || "",
    orderId: data.orderId || data.id || "",
    ownerUid: data.ownerUid || "",
    orderNumber: Number(data.orderNumber || 0),
    acknowledged: data.acknowledged === true,
    seenAtMs: Number(data.seenAtMs || Date.now()),
    updatedAtMs: Number(data.updatedAtMs || data.seenAtMs || Date.now()),
  };
}

function normalizeClientRequestId(value) {
  if (typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value)) return value;
  return crypto.randomUUID?.() || `order-${Date.now()}`;
}

function normalizeMessage(data) {
  return {
    id: data.id || "",
    orderId: data.orderId || "",
    sender: data.sender === "kitchen" ? "kitchen" : "guest",
    text: typeof data.text === "string" ? data.text : "",
    authorUid: data.authorUid || "",
    createdAtMs: Number(data.createdAtMs || Date.now()),
  };
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => a.createdAtMs - b.createdAtMs);
}

function hasUnavailable(meta, group, id) {
  return normalizeSessionMeta(meta).unavailable[group]?.[id] === true;
}

function validateUnavailableTarget(group, id) {
  if (!allowedUnavailable[group]?.includes(id)) {
    throw new Error("Element de disponibilite invalide.");
  }
}

function findUnavailableSelections(input, meta) {
  const unavailable = [];

  for (const id of normalizeArray(input.toppings, allowedToppings)) {
    if (hasUnavailable(meta, "toppings", id)) unavailable.push(itemLabels[id] || id);
  }

  for (const id of normalizeSauces(input.sauces, input.sauce).filter((item) => item !== noSauceId)) {
    if (hasUnavailable(meta, "sauces", id)) unavailable.push(itemLabels[id] || id);
  }

  if (input.nachos === true && hasUnavailable(meta, "extras", "nachos")) {
    unavailable.push(itemLabels.nachos);
  }

  return unavailable;
}

function assertOrderSessionState(input, meta) {
  const sessionMeta = normalizeSessionMeta(meta);

  if (sessionMeta.archived) {
    throw new Error("La session est archivee.");
  }

  if (sessionMeta.paused) {
    throw new Error("Le stand est en pause. Reessaie dans quelques minutes.");
  }

  const unavailable = findUnavailableSelections(input, sessionMeta);
  if (unavailable.length) {
    throw new Error(`${unavailable.join(", ")} n'est plus disponible.`);
  }
}

async function readFirebaseSessionMeta(db) {
  const [archived, paused, unavailable] = await Promise.all([
    get(ref(db, sessionPath("meta/archived"))),
    get(ref(db, sessionPath("meta/paused"))),
    get(ref(db, sessionPath("meta/unavailable"))),
  ]);

  return normalizeSessionMeta({
    archived: archived.val(),
    paused: paused.val(),
    unavailable: unavailable.val(),
  });
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
    nachos: input.nachos === true,
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

      const meta = await readFirebaseSessionMeta(db);
      assertOrderSessionState(input, meta);

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

      try {
        await set(ref(db, sessionPath(`queuePublic/${orderId}`)), queueEntryFromOrder(optimisticPayload));
      } catch (err) {
        console.warn("QUEUE_SYNC_ERROR", err);
      }

      return normalizeOrder(optimisticPayload);
    },

    subscribeOrderMessages(orderId, onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      const messagesRef = ref(db, sessionPath(`orderMessages/${orderId}`));
      const unsubscribe = onValue(
        messagesRef,
        (snapshot) => {
          const value = snapshot.val() || {};
          onChange(sortMessages(Object.values(value).map(normalizeMessage)));
        },
        onError,
      );

      return () => unsubscribe?.();
    },

    async sendOrderMessage(orderId, text, sender = "guest") {
      const safeText = cleanMessageText(text);
      if (!safeText) throw new Error("Message vide.");
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");

      const user = sender === "kitchen" ? await requireKitchenUser() : await ensureGuestAuth();
      const { db } = requireFirebaseRuntime();
      const messagesRef = ref(db, sessionPath(`orderMessages/${orderId}`));
      const messageRef = push(messagesRef);
      assertValidFirebaseKey(messageRef.key, "messageId");

      const payload = {
        id: messageRef.key,
        orderId,
        sender: sender === "kitchen" ? "kitchen" : "guest",
        text: safeText,
        authorUid: user.uid,
        createdAtMs: serverTimestamp(),
      };

      await set(messageRef, payload);
      return normalizeMessage({ ...payload, createdAtMs: Date.now() });
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

    subscribeQueue(onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      const queueRef = ref(db, sessionPath("queuePublic"));
      let unsubscribe;
      let cancelled = false;

      ensureGuestAuth()
        .then(() => {
          if (cancelled) return;
          unsubscribe = onValue(
            queueRef,
            (snapshot) => {
              const value = snapshot.val() || {};
              onChange(sortQueueEntries(Object.values(value).map(normalizeQueueEntry)));
            },
            onError,
          );
        })
        .catch(onError);

      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },

    subscribePickupAcks(onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      const acksRef = ref(db, sessionPath("pickupAcks"));
      let unsubscribe;
      let cancelled = false;

      requireKitchenUser()
        .then(() => {
          if (cancelled) return;
          unsubscribe = onValue(
            acksRef,
            (snapshot) => {
              const value = snapshot.val() || {};
              const acks = Object.values(value)
                .map(normalizePickupAck)
                .reduce((acc, ack) => {
                  if (ack.orderId) acc[ack.orderId] = ack;
                  return acc;
                }, {});
              onChange(acks);
            },
            onError,
          );
        })
        .catch(onError);

      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },

    subscribePickupAck(orderId, onChange, onError) {
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      const ackRef = ref(db, sessionPath(`pickupAcks/${orderId}`));
      let unsubscribe;
      let cancelled = false;

      ensureGuestAuth()
        .then(() => {
          if (cancelled) return;
          unsubscribe = onValue(
            ackRef,
            (snapshot) => {
              onChange(snapshot.exists() ? normalizePickupAck(snapshot.val()) : null);
            },
            onError,
          );
        })
        .catch(onError);

      return () => {
        cancelled = true;
        unsubscribe?.();
      };
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

    async updateStatus(orderId, status, order = null) {
      if (!allowedStatuses.includes(status)) throw new Error("Statut invalide.");
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");
      await update(ref(db, sessionPath(`orders/${orderId}`)), {
        status,
        updatedAtMs: serverTimestamp(),
      });

      try {
        if (order) {
          await set(
            ref(db, sessionPath(`queuePublic/${orderId}`)),
            queueEntryFromOrder({ ...order, status, updatedAtMs: Date.now() }),
          );
        } else {
          await update(ref(db, sessionPath(`queuePublic/${orderId}`)), {
            status,
            updatedAtMs: Date.now(),
          });
        }
      } catch (err) {
        console.warn("QUEUE_SYNC_ERROR", err);
      }
    },

    async syncQueueIndex(orders) {
      await requireKitchenUser();
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      const updates = {};

      for (const order of orders) {
        assertValidFirebaseKey(order.id, "orderId");
        updates[sessionPath(`queuePublic/${order.id}`)] = queueEntryFromOrder(order);
      }

      if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
      }
    },

    async acknowledgePickup(orderId) {
      const user = await ensureGuestAuth();
      const { db } = requireFirebaseRuntime();
      assertSessionKey();
      assertValidFirebaseKey(orderId, "orderId");

      const orderSnapshot = await get(ref(db, sessionPath(`orders/${orderId}`)));
      if (!orderSnapshot.exists()) throw new Error("Commande introuvable.");

      const order = normalizeOrder(orderSnapshot.val());
      if (order.guestUid !== user.uid) throw new Error("Cette commande n'est pas liée à cet appareil.");
      if (order.status !== "ready") throw new Error("La commande n'est pas encore prête.");

      const payload = {
        id: orderId,
        orderId,
        ownerUid: user.uid,
        orderNumber: order.number,
        acknowledged: true,
        seenAtMs: serverTimestamp(),
        updatedAtMs: serverTimestamp(),
      };

      await set(ref(db, sessionPath(`pickupAcks/${orderId}`)), payload);
      return normalizePickupAck({ ...payload, seenAtMs: Date.now(), updatedAtMs: Date.now() });
    },

    async archiveSession() {
      await archiveFirebaseSession();
    },

    async setSessionPaused(paused) {
      await setFirebaseSessionPaused(paused);
    },

    async setUnavailableItem(group, id, unavailable) {
      validateUnavailableTarget(group, id);
      await setFirebaseUnavailableItem(group, id, unavailable);
    },
  };
}

function makeLocalStore() {
  const ordersKey = `sarah-burger:${sessionId}:orders`;
  const counterKey = `sarah-burger:${sessionId}:counter`;
  const archiveKey = `sarah-burger:${sessionId}:archived`;
  const pausedKey = `sarah-burger:${sessionId}:paused`;
  const unavailableKey = `sarah-burger:${sessionId}:unavailable`;
  const messagesKey = `sarah-burger:${sessionId}:messages`;
  const pickupAcksKey = `sarah-burger:${sessionId}:pickupAcks`;
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

  function readUnavailable() {
    try {
      return JSON.parse(localStorage.getItem(unavailableKey) || "{}");
    } catch {
      return {};
    }
  }

  function readLocalMeta() {
    return normalizeSessionMeta({
      archived: localStorage.getItem(archiveKey) === "yes",
      paused: localStorage.getItem(pausedKey) === "yes",
      unavailable: readUnavailable(),
    });
  }

  function writeUnavailable(value) {
    localStorage.setItem(unavailableKey, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    channel?.postMessage("changed");
  }

  function readMessages() {
    try {
      return JSON.parse(localStorage.getItem(messagesKey) || "{}");
    } catch {
      return {};
    }
  }

  function writeMessages(messages) {
    localStorage.setItem(messagesKey, JSON.stringify(messages));
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    channel?.postMessage("changed");
  }

  function readPickupAcks() {
    try {
      return JSON.parse(localStorage.getItem(pickupAcksKey) || "{}");
    } catch {
      return {};
    }
  }

  function writePickupAcks(acks) {
    localStorage.setItem(pickupAcksKey, JSON.stringify(acks));
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
      const handler = () => onChange(readLocalMeta());
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

      assertOrderSessionState(input, readLocalMeta());

      const order = {
        ...createOrderPayload({ ...input, clientRequestId }, nextNumber(), { uid: "local" }),
      };
      writeOrders([...readOrders(), order]);
      return normalizeOrder(order);
    },

    subscribeOrders(onChange) {
      return subscribeLocal(onChange);
    },

    subscribeQueue(onChange) {
      return subscribeLocal((orders) => {
        onChange(sortQueueEntries(orders.map((order) => queueEntryFromOrder(order))));
      });
    },

    subscribePickupAcks(onChange) {
      const handler = () => {
        const acks = Object.values(readPickupAcks())
          .map(normalizePickupAck)
          .reduce((acc, ack) => {
            if (ack.orderId) acc[ack.orderId] = ack;
            return acc;
          }, {});
        onChange(acks);
      };
      window.addEventListener(LOCAL_EVENT, handler);
      window.addEventListener("storage", handler);
      channel?.addEventListener("message", handler);
      handler();
      return () => {
        window.removeEventListener(LOCAL_EVENT, handler);
        window.removeEventListener("storage", handler);
        channel?.removeEventListener("message", handler);
      };
    },

    subscribePickupAck(orderId, onChange) {
      assertValidFirebaseKey(orderId, "orderId");
      const handler = () => {
        const ack = readPickupAcks()[orderId];
        onChange(ack ? normalizePickupAck(ack) : null);
      };
      window.addEventListener(LOCAL_EVENT, handler);
      window.addEventListener("storage", handler);
      channel?.addEventListener("message", handler);
      handler();
      return () => {
        window.removeEventListener(LOCAL_EVENT, handler);
        window.removeEventListener("storage", handler);
        channel?.removeEventListener("message", handler);
      };
    },

    subscribeOrderMessages(orderId, onChange) {
      assertValidFirebaseKey(orderId, "orderId");
      const handler = () => {
        const messages = readMessages()[orderId] || {};
        onChange(sortMessages(Object.values(messages).map(normalizeMessage)));
      };
      window.addEventListener(LOCAL_EVENT, handler);
      handler();
      return () => window.removeEventListener(LOCAL_EVENT, handler);
    },

    async sendOrderMessage(orderId, text, sender = "guest") {
      assertValidFirebaseKey(orderId, "orderId");
      const safeText = cleanMessageText(text);
      if (!safeText) throw new Error("Message vide.");

      const order = readOrders().find((item) => item.id === orderId);
      if (!order) throw new Error("Commande introuvable.");
      if (order.status === "served" || order.status === "cancelled") {
        throw new Error("Cette commande est terminee.");
      }

      const id = crypto.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      assertValidFirebaseKey(id, "messageId");
      const message = normalizeMessage({
        id,
        orderId,
        sender: sender === "kitchen" ? "kitchen" : "guest",
        text: safeText,
        authorUid: sender === "kitchen" ? "local-kitchen" : "local",
        createdAtMs: Date.now(),
      });
      const messages = readMessages();
      messages[orderId] = { ...(messages[orderId] || {}), [id]: message };
      writeMessages(messages);
      return message;
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

    async syncQueueIndex() {},

    async acknowledgePickup(orderId) {
      assertValidFirebaseKey(orderId, "orderId");
      const order = readOrders().find((item) => item.id === orderId);
      if (!order) throw new Error("Commande introuvable.");
      if (order.status !== "ready") throw new Error("La commande n'est pas encore prête.");

      const ack = normalizePickupAck({
        id: orderId,
        orderId,
        ownerUid: "local",
        orderNumber: order.number,
        acknowledged: true,
        seenAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
      writePickupAcks({ ...readPickupAcks(), [orderId]: ack });
      return ack;
    },

    async archiveSession() {
      localStorage.setItem(archiveKey, "yes");
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    },

    async setSessionPaused(paused) {
      localStorage.setItem(pausedKey, paused ? "yes" : "no");
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    },

    async setUnavailableItem(group, id, unavailable) {
      validateUnavailableTarget(group, id);
      const current = readUnavailable();
      current[group] = { ...(current[group] || {}), [id]: unavailable === true };
      writeUnavailable(current);
    },
  };
}

export function createOrderStore() {
  return hasFirebaseConfig() ? makeFirebaseOrderStore() : makeLocalStore();
}
