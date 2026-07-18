import { useCallback, useEffect, useMemo, useState } from "react";

function isPermissionError(error) {
  const message = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return message.includes("permission_denied") || message.includes("permission denied");
}

function friendlyPickupError(error) {
  if (isPermissionError(error)) {
    return "Le stand n'a pas pu etre prevenu depuis cet appareil. Garde ton numero et passe au comptoir.";
  }

  return error?.message || "Le stand n'a pas pu etre prevenu.";
}

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
        (err) => {
          if (isPermissionError(err)) {
            console.warn("PICKUP_ACK_SUBSCRIPTION_DENIED", err);
            return;
          }

          setError("Accuse de retrait indisponible.");
        },
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
        const ack = await store.acknowledgePickup(entry.orderId, {
          orderNumber: entry.number,
          pickupToken: entry.pickupToken,
        });
        setAcks((current) => ({ ...current, [entry.orderId]: ack }));
      } catch (err) {
        console.error("PICKUP_ACK_ERROR", err);
        setError(friendlyPickupError(err));
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
