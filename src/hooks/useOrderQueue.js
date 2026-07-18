import { useCallback, useEffect, useMemo, useState } from "react";

const ACTIVE_STATUSES = new Set(["received", "preparing"]);
const FINISHED_STATUSES = new Set(["ready", "served", "cancelled"]);

function pluralizeBurger(count) {
  return count > 1 ? "burgers" : "burger";
}

function estimateWait(aheadCount) {
  if (aheadCount <= 0) return "moins de 5 min";
  if (aheadCount <= 2) return "5 à 8 min";
  if (aheadCount <= 5) return "10 à 15 min";
  return "plus de 15 min";
}

function getEntryStatus(order) {
  return order?.lastStatus || order?.status || "received";
}

export function buildQueueInfo(order, queueEntries, { snapshotReady = true, error = "" } = {}) {
  const status = getEntryStatus(order);
  const orderId = order?.orderId || order?.id || "";
  const orderNumber = Number(order?.number);

  if (!order || FINISHED_STATUSES.has(status)) {
    return { visible: false, status };
  }

  if (error) {
    return {
      visible: true,
      tone: "muted",
      title: "File indisponible",
      detail: "Le stand suit quand même ta commande.",
      shortLabel: "file indisponible",
      aheadCount: null,
    };
  }

  if (!snapshotReady || !Number.isFinite(orderNumber)) {
    return {
      visible: true,
      tone: "loading",
      title: "File en direct",
      detail: "Calcul de ta position...",
      shortLabel: "calcul...",
      aheadCount: null,
    };
  }

  const activeEntries = queueEntries
    .filter((entry) => ACTIVE_STATUSES.has(entry.status) && Number.isFinite(Number(entry.number)))
    .sort((a, b) => Number(a.number) - Number(b.number));
  const ownEntry = activeEntries.find((entry) => entry.id === orderId);

  if (!ownEntry) {
    return {
      visible: true,
      tone: "loading",
      title: "File en direct",
      detail: "On recale ta position avec le stand.",
      shortLabel: "position en cours",
      aheadCount: null,
    };
  }

  const aheadCount = activeEntries.filter((entry) => Number(entry.number) < orderNumber).length;

  if (status === "preparing") {
    return {
      visible: true,
      tone: "hot",
      title: "Sur le grill",
      detail: "La cuisine prépare ton burger maintenant.",
      shortLabel: "en préparation",
      aheadCount,
    };
  }

  if (aheadCount === 0) {
    return {
      visible: true,
      tone: "next",
      title: "Tu es le prochain",
      detail: "Attente estimée : moins de 5 min.",
      shortLabel: "prochain",
      aheadCount,
    };
  }

  return {
    visible: true,
    tone: "waiting",
    title: `${aheadCount} ${pluralizeBurger(aheadCount)} avant toi`,
    detail: `Attente estimée : ${estimateWait(aheadCount)}.`,
    shortLabel: `${aheadCount} avant`,
    aheadCount,
  };
}

export function useOrderQueue(store, trackedOrders) {
  const [queueEntries, setQueueEntries] = useState([]);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [error, setError] = useState("");
  const orderIds = useMemo(
    () => trackedOrders.map((order) => order.orderId).filter(Boolean).join(","),
    [trackedOrders],
  );

  useEffect(() => {
    if (!orderIds || !store.subscribeQueue) {
      setQueueEntries([]);
      setSnapshotReady(false);
      setError("");
      return undefined;
    }

    setSnapshotReady(false);
    setError("");

    return store.subscribeQueue(
      (entries) => {
        setQueueEntries(entries);
        setSnapshotReady(true);
      },
      (err) => {
        setError(err.message || "File indisponible.");
        setSnapshotReady(true);
      },
    );
  }, [orderIds, store]);

  const getInfo = useCallback(
    (order) => buildQueueInfo(order, queueEntries, { snapshotReady, error }),
    [error, queueEntries, snapshotReady],
  );

  return {
    entries: queueEntries,
    error,
    getInfo,
    snapshotReady,
  };
}
