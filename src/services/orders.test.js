import { beforeEach, describe, expect, it } from "vitest";
import { assertValidFirebaseKey, createOrderStore, normalizeOrder } from "./orders";

describe("normalizeOrder", () => {
  it("falls back to received for an invalid status", () => {
    const order = normalizeOrder({
      id: "o1",
      number: "20",
      guestName: "Léa",
      status: "bogus",
      createdAtMs: 1000,
    });
    expect(order.status).toBe("received");
    expect(order.number).toBe(20);
  });

  it("reads the legacy single sauce field when sauces is absent", () => {
    const order = normalizeOrder({
      id: "o2",
      number: 21,
      guestName: "Tom",
      sauce: "ketchup",
      status: "preparing",
      createdAtMs: 1000,
    });
    expect(order.sauces).toEqual(["ketchup"]);
  });

  it("reads sauces stored as a Firebase boolean map", () => {
    const order = normalizeOrder({
      id: "o3",
      number: 22,
      guestName: "Zoé",
      sauces: { mayo: true, ketchup: true, spicy: false },
      status: "received",
      createdAtMs: 1000,
    });
    expect(order.sauces.sort()).toEqual(["ketchup", "mayo"]);
  });

  it("treats 'Sans sauce' as exclusive", () => {
    const order = normalizeOrder({
      id: "o4",
      number: 23,
      guestName: "Nino",
      sauces: { none: true },
      status: "received",
      createdAtMs: 1000,
    });
    expect(order.sauces).toEqual(["none"]);
  });

  it("drops toppings and sauces that aren't in the allowed menu", () => {
    const order = normalizeOrder({
      id: "o5",
      number: 24,
      guestName: "Ana",
      toppings: { pickles: true, cheese: true },
      sauces: { mayo: true, alien: true },
      status: "received",
      createdAtMs: 1000,
    });
    expect(order.toppings).toEqual(["pickles"]);
    expect(order.sauces).toEqual(["mayo"]);
  });
});

describe("assertValidFirebaseKey", () => {
  it("rejects empty values", () => {
    expect(() => assertValidFirebaseKey("", "orderId")).toThrow();
  });

  it("rejects Firebase-reserved characters", () => {
    expect(() => assertValidFirebaseKey("a/b", "orderId")).toThrow();
    expect(() => assertValidFirebaseKey("a.b", "orderId")).toThrow();
  });

  it("accepts a plain alphanumeric id", () => {
    expect(() => assertValidFirebaseKey("order-abc123", "orderId")).not.toThrow();
  });
});

describe("local order store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reserves increasing order numbers starting at the configured first number", async () => {
    const store = createOrderStore();
    expect(store.mode).toBe("local");

    const first = await store.createOrder({
      guestName: "Tom",
      toppings: ["pickles"],
      sauces: ["ketchup"],
      clientRequestId: "order-aaaaaaaa",
    });
    const second = await store.createOrder({
      guestName: "Léa",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-bbbbbbbb",
    });

    expect(second.number).toBe(first.number + 1);
  });

  it("returns the existing order instead of duplicating on a retried clientRequestId", async () => {
    const store = createOrderStore();
    const input = {
      guestName: "Tom",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-cccccccc",
    };

    const first = await store.createOrder(input);
    const retry = await store.createOrder(input);

    expect(retry.id).toBe(first.id);
    expect(retry.number).toBe(first.number);
  });

  it("moves an order through updateStatus", async () => {
    const store = createOrderStore();
    const order = await store.createOrder({
      guestName: "Tom",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-dddddddd",
    });

    await store.updateStatus(order.id, "preparing");

    let latest;
    const unsubscribe = store.subscribeOrders((value) => {
      latest = value;
    });
    unsubscribe();

    expect(latest.find((item) => item.id === order.id).status).toBe("preparing");
  });

  it("blocks new orders once the session is archived", async () => {
    const store = createOrderStore();
    await store.archiveSession();

    await expect(
      store.createOrder({
        guestName: "Tom",
        toppings: [],
        sauces: ["none"],
        clientRequestId: "order-eeeeeeee",
      }),
    ).rejects.toThrow("archivée");
  });
});
