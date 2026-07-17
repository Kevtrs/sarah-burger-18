import { useEffect, useMemo, useState } from "react";
import { BrandHeader } from "./components/BrandHeader";
import { GuestOrder } from "./components/GuestOrder";
import { KitchenDashboard } from "./components/KitchenDashboard";
import { createOrderStore } from "./services/orderStore";
import { notifyLedBridge } from "./services/ledBridge";

function routeFromHash() {
  return window.location.hash.replace("#", "") === "stand" ? "kitchen" : "order";
}

function hashFromRoute(route) {
  return route === "kitchen" ? "#stand" : "#commande";
}

export default function App() {
  const [route, setRouteState] = useState(routeFromHash);
  const store = useMemo(() => {
    const baseStore = createOrderStore();
    let orderCache = [];

    return {
      ...baseStore,
      subscribeOrders(onChange, onError) {
        return baseStore.subscribeOrders((orders) => {
          orderCache = orders;
          onChange(orders);
        }, onError);
      },
      async updateStatus(orderId, status) {
        const matchedOrder = orderCache.find((order) => order.id === orderId);
        await baseStore.updateStatus(orderId, status);
        if (matchedOrder) void notifyLedBridge(matchedOrder, status);
      },
    };
  }, []);

  useEffect(() => {
    const handler = () => setRouteState(routeFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  function setRoute(nextRoute) {
    window.location.hash = hashFromRoute(nextRoute);
    setRouteState(nextRoute);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  return (
    <div className={`app-shell route-${route}`}>
      <BrandHeader route={route} setRoute={setRoute} />
      {route === "kitchen" ? (
        <KitchenDashboard store={store} />
      ) : (
        <GuestOrder store={store} />
      )}
    </div>
  );
}
