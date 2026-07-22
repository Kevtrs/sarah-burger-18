import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KitchenDashboard } from "./KitchenDashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function makeStore(orders) {
  return {
    mode: "local",
    subscribeOrders(onChange) {
      onChange(orders);
      return () => {};
    },
    subscribeSessionMeta(onChange) {
      onChange({});
      return () => {};
    },
    subscribePickupAcks(onChange) {
      onChange({});
      return () => {};
    },
    subscribeOrderMessages(_orderId, onChange) {
      onChange([]);
      return () => {};
    },
    syncQueueIndex: vi.fn(async () => {}),
    signOutKitchen: vi.fn(async () => {}),
    updateStatus: vi.fn(async () => {}),
  };
}

function renderDashboard(orders) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root.render(<KitchenDashboard store={makeStore(orders)} />);
  });

  return container;
}

describe("KitchenDashboard cashier badge", () => {
  it("shows the CAISSE badge for cashier orders", () => {
    const container = renderDashboard([
      {
        id: "cashier-order-1",
        number: 44,
        guestName: "Kevin",
        source: "cashier",
        toppings: ["pickles"],
        sauces: ["bigmac"],
        nachos: false,
        status: "received",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    ]);

    expect(container.textContent).toContain("CAISSE");
  });

  it("does not show the CAISSE badge for guest orders", () => {
    const container = renderDashboard([
      {
        id: "guest-order-1",
        number: 45,
        guestName: "Lea",
        source: "guest",
        toppings: [],
        sauces: ["none"],
        nachos: false,
        status: "received",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    ]);

    expect(container.textContent).not.toContain("CAISSE");
  });
});
