import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "sarah-burger-ready-alert-v1";
const READY_SOUND_URL = `${import.meta.env.BASE_URL}audio/ready-alert.wav`;
const READY_FROM_STATUSES = new Set(["received", "preparing"]);

function getNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

function readStoredAlert() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.orderId !== "string" || !parsed.orderId) return null;
    return {
      guestName: typeof parsed.guestName === "string" ? parsed.guestName : "",
      lastStatus: typeof parsed.lastStatus === "string" ? parsed.lastStatus : "received",
      notificationPermission: parsed.notificationPermission || getNotificationPermission(),
      notificationsEnabled: parsed.notificationsEnabled === true,
      number: Number(parsed.number || 0),
      orderId: parsed.orderId,
      readyNotified: parsed.readyNotified === true,
      watchEnabled: parsed.watchEnabled === true,
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

function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
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
  if (!audioRef.current) return;

  const audio = audioRef.current;
  audio.muted = true;
  try {
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // A browser can keep audio locked until a later user gesture.
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
    // Visual status remains the reliable fallback if audio is blocked.
  }
}

export function useReadyOrderAlert(store) {
  const [trackedOrder, setTrackedOrder] = useState(readStoredAlert);
  const [currentStatus, setCurrentStatus] = useState(() => trackedOrder?.lastStatus || "");
  const [permission, setPermission] = useState(getNotificationPermission);
  const [message, setMessage] = useState("");
  const [readyAnnounced, setReadyAnnounced] = useState(() => trackedOrder?.readyNotified === true);
  const audioRef = useRef(null);
  const previousStatusRef = useRef(trackedOrder?.lastStatus || "");
  const notifiedOrderRef = useRef(trackedOrder?.readyNotified ? trackedOrder.orderId : "");
  const isIosDevice = useMemo(isAppleTouchDevice, []);

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
        guestName: order.guestName || existing?.guestName || "",
        lastStatus: order.status || existing?.lastStatus || "received",
        notificationPermission: getNotificationPermission(),
        notificationsEnabled: sameOrder ? existing?.notificationsEnabled === true : false,
        number: Number(order.number || existing?.number || 0),
        orderId: order.id,
        readyNotified: sameOrder ? existing?.readyNotified === true : false,
        watchEnabled: sameOrder ? existing?.watchEnabled === true : false,
      };

      previousStatusRef.current = next.lastStatus;
      notifiedOrderRef.current = next.readyNotified ? next.orderId : "";
      setCurrentStatus(next.lastStatus);
      setReadyAnnounced(next.readyNotified);
      updateStoredAlert(next);
    },
    [updateStoredAlert],
  );

  const clearTrackedOrder = useCallback(() => {
    previousStatusRef.current = "";
    notifiedOrderRef.current = "";
    setCurrentStatus("");
    setReadyAnnounced(false);
    updateStoredAlert(null);
  }, [updateStoredAlert]);

  const enableAlerts = useCallback(async () => {
    if (!trackedOrder?.orderId) return;

    await unlockAudio(audioRef);

    let nextPermission = getNotificationPermission();
    if ("Notification" in window && nextPermission === "default") {
      nextPermission = await window.Notification.requestPermission();
    }

    const notificationsEnabled = nextPermission === "granted";
    setPermission(nextPermission);
    updateStoredAlert((current) => {
      if (!current?.orderId) return current;
      return {
        ...current,
        notificationPermission: nextPermission,
        notificationsEnabled,
        watchEnabled: true,
      };
    });

    setMessage(
      notificationsEnabled
        ? "Alerte activée. On te prévient dès que la commande passe prête."
        : "Garde cette page ouverte pour être averti.",
    );
  }, [trackedOrder?.orderId, updateStoredAlert]);

  const fireReadyAlert = useCallback(
    async ({ test = false } = {}) => {
      if (!trackedOrder?.orderId) return;
      if (!test && notifiedOrderRef.current === trackedOrder.orderId) return;

      const numberLabel = trackedOrder.number ? `#${trackedOrder.number}` : "";
      const body = `Commande ${numberLabel} — viens la récupérer au stand Sarah Burger.`;

      if (
        trackedOrder.notificationsEnabled &&
        getNotificationPermission() === "granted" &&
        typeof window !== "undefined" &&
        "Notification" in window
      ) {
        try {
          new window.Notification("Ton burger est prêt 🍔", {
            body,
            tag: `sarah-burger-ready-${trackedOrder.orderId}`,
            renotify: false,
          });
        } catch {
          // System notifications are best-effort; in-app alert stays visible.
        }
      }

      if (!test) {
        notifiedOrderRef.current = trackedOrder.orderId;
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
        setMessage("Garde cette page ouverte pour être averti.");
      },
    );
  }, [fireReadyAlert, store, trackedOrder, updateStoredAlert]);

  return {
    canTestNotification: import.meta.env.DEV,
    clearTrackedOrder,
    currentStatus,
    enableAlerts,
    fireReadyAlert,
    isIosDevice,
    message,
    notificationSupported: permission !== "unsupported",
    permission,
    readyAnnounced,
    trackOrder,
    trackedOrder,
  };
}
