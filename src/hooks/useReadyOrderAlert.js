import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "sarah-burger-ready-alert-v1";
const READY_SOUND_URL = `${import.meta.env.BASE_URL}audio/ready-alert.wav`;
const READY_FROM_STATUSES = new Set(["received", "preparing"]);

function readStoredAlert() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.orderId !== "string" || !parsed.orderId) return null;
    return {
      audioUnlocked: parsed.audioUnlocked === true,
      guestName: typeof parsed.guestName === "string" ? parsed.guestName : "",
      lastStatus: typeof parsed.lastStatus === "string" ? parsed.lastStatus : "received",
      number: Number(parsed.number || 0),
      orderId: parsed.orderId,
      readyNotified: parsed.readyNotified === true,
      watchEnabled: parsed.watchEnabled !== false,
    };
  } catch {
    return null;
  }
}

function writeStoredAlert(value) {
  if (typeof window === "undefined") return;

  if (!value?.orderId) {
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
  const [trackedOrder, setTrackedOrder] = useState(readStoredAlert);
  const [currentStatus, setCurrentStatus] = useState(() => trackedOrder?.lastStatus || "");
  const [message, setMessage] = useState("");
  const [readyAnnounced, setReadyAnnounced] = useState(() => trackedOrder?.readyNotified === true);
  const audioRef = useRef(null);
  const previousStatusRef = useRef(trackedOrder?.lastStatus || "");
  const notifiedOrderRef = useRef(trackedOrder?.readyNotified ? trackedOrder.orderId : "");

  const updateStoredAlert = useCallback((updater) => {
    setTrackedOrder((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      writeStoredAlert(next);
      return next;
    });
  }, []);

  const trackOrder = useCallback(
    (order) => {
      if (!order?.id) return;

      const existing = readStoredAlert();
      const sameOrder = existing?.orderId === order.id;
      const next = {
        audioUnlocked: sameOrder ? existing?.audioUnlocked === true : false,
        guestName: order.guestName || existing?.guestName || "",
        lastStatus: order.status || existing?.lastStatus || "received",
        number: Number(order.number || existing?.number || 0),
        orderId: order.id,
        readyNotified: sameOrder ? existing?.readyNotified === true : false,
        watchEnabled: true,
      };

      previousStatusRef.current = next.lastStatus;
      notifiedOrderRef.current = next.readyNotified ? next.orderId : "";
      setCurrentStatus(next.lastStatus);
      setReadyAnnounced(next.readyNotified);
      setMessage("Garde cette page ouverte pour être averti lorsque ta commande est prête.");
      updateStoredAlert(next);
    },
    [updateStoredAlert],
  );

  const clearTrackedOrder = useCallback(() => {
    previousStatusRef.current = "";
    notifiedOrderRef.current = "";
    setCurrentStatus("");
    setReadyAnnounced(false);
    setMessage("");
    updateStoredAlert(null);
  }, [updateStoredAlert]);

  const enableAlerts = useCallback(async () => {
    if (!trackedOrder?.orderId) return;

    const audioUnlocked = await unlockAudio(audioRef);
    updateStoredAlert((current) => {
      if (!current?.orderId) return current;
      return {
        ...current,
        audioUnlocked,
        watchEnabled: true,
      };
    });

    setMessage(
      audioUnlocked
        ? "Alerte de page activée. Garde cette page ouverte."
        : "Garde cette page ouverte pour être averti lorsque ta commande est prête.",
    );
  }, [trackedOrder?.orderId, updateStoredAlert]);

  const fireReadyAlert = useCallback(
    async ({ test = false } = {}) => {
      if (!trackedOrder?.orderId) return;
      if (!test && notifiedOrderRef.current === trackedOrder.orderId) return;

      if (!test) {
        notifiedOrderRef.current = trackedOrder.orderId;
        setCurrentStatus("ready");
        setReadyAnnounced(true);
        updateStoredAlert((current) => {
          if (!current?.orderId) return current;
          return {
            ...current,
            lastStatus: "ready",
            readyNotified: true,
          };
        });
      }

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(120);
      }

      await playReadySound(audioRef);
      setMessage("Ta commande est prête !");
    },
    [trackedOrder, updateStoredAlert],
  );

  useEffect(() => {
    if (!trackedOrder?.orderId || !store.subscribeOrderStatus) return undefined;

    return store.subscribeOrderStatus(
      trackedOrder.orderId,
      (status) => {
        if (!status) return;

        const previousStatus = previousStatusRef.current || trackedOrder.lastStatus || "";
        previousStatusRef.current = status;
        setCurrentStatus(status);

        updateStoredAlert((current) => {
          if (!current?.orderId) return current;
          return { ...current, lastStatus: status };
        });

        if (
          READY_FROM_STATUSES.has(previousStatus) &&
          status === "ready" &&
          trackedOrder.watchEnabled &&
          !trackedOrder.readyNotified &&
          notifiedOrderRef.current !== trackedOrder.orderId
        ) {
          void fireReadyAlert();
        }
      },
      () => {
        setMessage("Garde cette page ouverte pour être averti lorsque ta commande est prête.");
      },
    );
  }, [fireReadyAlert, store, trackedOrder, updateStoredAlert]);

  return {
    audioUnlocked: trackedOrder?.audioUnlocked === true,
    canTestAlert: import.meta.env.DEV,
    clearTrackedOrder,
    currentStatus,
    enableAlerts,
    fireReadyAlert,
    message,
    readyAnnounced,
    trackOrder,
    trackedOrder,
  };
}
