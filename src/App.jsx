import { useEffect, useMemo, useState } from "react";
import { BrandHeader } from "./components/BrandHeader";
import { GuestOrder } from "./components/GuestOrder";
import { KitchenDashboard } from "./components/KitchenDashboard";
import { createOrderStore } from "./services/orderStore";

function routeFromHash() {
  return window.location.hash.replace("#", "") === "stand" ? "kitchen" : "order";
}

function hashFromRoute(route) {
  return route === "kitchen" ? "#stand" : "#commande";
}

export default function App() {
  const [route, setRouteState] = useState(routeFromHash);
  const store = useMemo(() => createOrderStore(), []);

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
