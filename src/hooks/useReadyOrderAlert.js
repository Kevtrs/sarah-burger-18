import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "sarah-burger-ready-alert-v2";
const READY_SOUND_URL = `${import.meta.env.BASE_URL}audio/ready-alert.wav`;
const READY_FROM_STATUSES = new Set(["received", "preparing"]);

function readStoredAlert() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || !Array.isArray(parsed.orders)) return null;

    const orders = parsed.orders
      .filter((item) => item && typeof item.orderId === "string" && item.orderId)
      .map((item) => ({
        orderId: item.orderId,
        guestName: typeof item.guestName === "string" ? item.guestName : "",
        lastStatus: typeof item.lastStatus === "string" ? item.lastStatus : "received",
        number: Number(item.number || 0),
        readyNotified: item.readyNotified === true,
        toppings: Array.isArray(item.toppings) ? item.toppings : [],
        sauces: Array.isArray(item.sauces) ? item.sauces : [],
        nachos: item.nachos === true,
      }));

    if (!orders.length) return null;
    return { audioUnlocked: parsed.audioUnlocked === true, orders };
  } catch {
    return null;
  }
}

function writeStoredAlert(value) {
  if (typeof window === "undefined") return;

  if (!value?.orders?.length) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function createAudioElement() {
  if (typeof Audio === "undefined") return null;
  const audio = new Audio(READY_SOUND_URL);
  audio.preload = "auto";
  audio.volume = 0.24;
  return audio;
}

async function unlockAudio(audioRef) {
  if (!audioRef.current) audioRef.current = createAudioElement();
  if (!audioRef.current) return false;

  const audio = audioRef.current;
  audio.muted = true;
  try {
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    return true;
  } catch {
    return false;
  } finally {
    audio.muted = false;
  }
}

async function playReadySound(audioRef) {
  if (!audioRef.current) audioRef.current = createAudioElement();
  if (!audioRef.current) return;

  try {
    audioRef.current.currentTime = 0;
    await audioRef.current.play();
  } catch {
    // Le message visuel reste l'alerte fiable si le navigateur bloque le son.
  }
}

export function useReadyOrderAlert(store) {
  const [state, setState] = useState(() => readStoredAlert() || { audioUnlocked: false, orders: [] });
  const [message, setMessage] = useState("");
  const audioRef = useRef(null);
  const previousStatusRef = useRef(new Map(state.orders.map((item) => [item.orderId, item.lastStatus])));
  const notifiedRef = useRef(new Set(state.orders.filter((item) => item.readyNotified).map((item) => item.orderId)));

  const updateState = useCallback((updater) => {
    setState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      writeStoredAlert(next);
      return next;
    });
  }, []);

  const trackOrder = useCallback(
    (order) => {
      if (!order?.id) return;

      updateState((current) => {
        const existing = current.orders.find((item) => item.orderId === order.id);
        const entry = {
          orderId: order.id,
          guestName: order.guestName || existing?.guestName || "",
          lastStatus: order.status || existing?.lastStatus || "received",
          number: Number(order.number || existing?.number || 0),
          readyNotified: existing?.readyNotified === true,
          toppings: Array.isArray(order.toppings) ? order.toppings : existing?.toppings || [],
          sauces: Array.isArray(order.sauces) ? order.sauces : existing?.sauces || [],
          nachos: order.nachos ?? existing?.nachos ?? false,
        };

        previousStatusRef.current.set(order.id, entry.lastStatus);
        if (entry.readyNotified) notifiedRef.current.add(order.id);

        const others = current.orders.filter((item) => item.orderId !== order.id);
        return { ...current, orders: [...others, entry] };
      });

      setMessage("");
    },
    [updateState],
  );

  const clearTrackedOrders = useCallback(() => {
    previousStatusRef.current = new Map();
    notifiedRef.current = new Set();
    setMessage("");
    updateState({ audioUnlocked: false, orders: [] });
  }, [updateState]);

  const enableAlerts = useCallback(async ({ silent = false } = {}) => {
    const audioUnlocked = await unlockAudio(audioRef);
    updateState((current) => ({ ...current, audioUnlocked }));

    if (!silent) {
      setMessage(audioUnlocked ? "Alerte de page activée." : "");
    }
  }, [updateState]);

  const fireReadyAlert = useCallback(
    async (orderId, { test = false } = {}) => {
      if (!test) {
        if (!orderId || notifiedRef.current.has(orderId)) return;
        notifiedRef.current.add(orderId);
        updateState((current) => ({
          ...current,
          orders: current.orders.map((item) =>
            item.orderId === orderId ? { ...item, lastStatus: "ready", readyNotified: true } : item,
          ),
        }));
      }

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(120);
      }

      await playReadySound(audioRef);
      setMessage("Ta commande est prête !");
    },
    [updateState],
  );

  const orderIds = useMemo(() => state.orders.map((item) => item.orderId).join(","), [state.orders]);

  useEffect(() => {
    if (!store.subscribeOrderStatus || !orderIds) return undefined;

    const unsubscribers = orderIds.split(",").map((orderId) =>
      store.subscribeOrderStatus(
        orderId,
        (status) => {
          if (!status) return;

          const previousStatus = previousStatusRef.current.get(orderId) || "received";
          previousStatusRef.current.set(orderId, status);

          updateState((current) => ({
            ...current,
            orders: current.orders.map((item) => (item.orderId === orderId ? { ...item, lastStatus: status } : item)),
          }));

          if (READY_FROM_STATUSES.has(previousStatus) && status === "ready" && !notifiedRef.current.has(orderId)) {
            void fireReadyAlert(orderId);
          }
        },
        () => {
          setMessage("");
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [fireReadyAlert, orderIds, store, updateState]);

  return {
    audioUnlocked: state.audioUnlocked,
    canTestAlert: import.meta.env.DEV,
    clearTrackedOrders,
    enableAlerts,
    fireReadyAlert,
    message,
    readyAnnounced: state.orders.some((item) => item.lastStatus === "ready"),
    trackOrder,
    trackedOrders: state.orders,
  };
}
