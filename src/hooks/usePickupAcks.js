import { useCallback, useEffect, useMemo, useState } from "react";

export function usePickupAcks(store, trackedOrders) {
  const [acks, setAcks] = useState({});
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const orderIds = useMemo(
    () => trackedOrders.map((order) => order.orderId).filter(Boolean).join(","),
    [trackedOrders],
  );

  useEffect(() => {
    if (!orderIds || !store.subscribePickupAck) {
      setAcks({});
      return undefined;
    }

    const unsubscribers = orderIds.split(",").map((orderId) =>
      store.subscribePickupAck(
        orderId,
        (ack) => {
          setAcks((current) => {
            if (!ack) {
              const next = { ...current };
              delete next[orderId];
              return next;
            }
            return { ...current, [orderId]: ack };
          });
        },
        (err) => setError(err.message || "Accuse de retrait indisponible."),
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [orderIds, store]);

  const acknowledge = useCallback(
    async (entry) => {
      if (!entry?.orderId || entry.lastStatus !== "ready" || !store.acknowledgePickup) return;

      setPendingId(entry.orderId);
      setError("");
      try {
        const ack = await store.acknowledgePickup(entry.orderId);
        setAcks((current) => ({ ...current, [entry.orderId]: ack }));
      } catch (err) {
        setError(err.message || "Le stand n'a pas pu être prévenu.");
      } finally {
        setPendingId("");
      }
    },
    [store],
  );

  return {
    acknowledge,
    acks,
    error,
    pendingId,
  };
}
