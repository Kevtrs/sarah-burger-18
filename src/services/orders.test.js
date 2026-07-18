import { beforeEach, describe, expect, it } from "vitest";
import { assertValidFirebaseKey, createOrderStore, normalizeOrder, normalizeQueueEntry } from "./orders";

describe("normalizeOrder", () => {
  it("falls back to received for an invalid status", () => {
    const order = normalizeOrder({
      id: "o1",
      number: "20",
      guestName: "Lea",
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
      guestName: "Zoe",
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

  it("defaults nachos to false and only accepts a strict boolean true", () => {
    const withoutField = normalizeOrder({
      id: "o6",
      number: 25,
      guestName: "Zoe",
      status: "received",
      createdAtMs: 1000,
    });
    const withTruthyString = normalizeOrder({
      id: "o7",
      number: 26,
      guestName: "Zoe",
      nachos: "true",
      status: "received",
      createdAtMs: 1000,
    });
    const withTrue = normalizeOrder({
      id: "o8",
      number: 27,
      guestName: "Zoe",
      nachos: true,
      status: "received",
      createdAtMs: 1000,
    });

    expect(withoutField.nachos).toBe(false);
    expect(withTruthyString.nachos).toBe(false);
    expect(withTrue.nachos).toBe(true);
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

describe("normalizeQueueEntry", () => {
  it("keeps only the public queue fields needed by guests", () => {
    const entry = normalizeQueueEntry({
      id: "order-queue1",
      sessionId: "sarah-18-2026",
      number: "28",
      status: "preparing",
      guestName: "Kevin",
      createdAtMs: 1000,
      updatedAtMs: 2000,
    });

    expect(entry).toEqual({
      id: "order-queue1",
      sessionId: "sarah-18-2026",
      number: 28,
      status: "preparing",
      createdAtMs: 1000,
      updatedAtMs: 2000,
    });
    expect(entry.guestName).toBeUndefined();
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
      nachos: true,
      clientRequestId: "order-aaaaaaaa",
    });
    const second = await store.createOrder({
      guestName: "Lea",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-bbbbbbbb",
    });

    expect(second.number).toBe(first.number + 1);
    expect(first.nachos).toBe(true);
    expect(second.nachos).toBe(false);
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

  it("exposes a public queue view that follows status changes", async () => {
    const store = createOrderStore();
    const first = await store.createOrder({
      guestName: "Tom",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-queuea",
    });
    const second = await store.createOrder({
      guestName: "Lea",
      toppings: [],
      sauces: ["ketchup"],
      clientRequestId: "order-queueb",
    });
    let queue = [];
    const unsubscribe = store.subscribeQueue((value) => {
      queue = value;
    });

    expect(queue.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(queue.map((entry) => entry.status)).toEqual(["received", "received"]);

    await store.updateStatus(first.id, "ready");

    expect(queue.find((entry) => entry.id === first.id).status).toBe("ready");
    unsubscribe();
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
    ).rejects.toThrow("archiv");
  });

  it("blocks new orders while the stand is paused", async () => {
    const store = createOrderStore();
    await store.setSessionPaused(true);

    await expect(
      store.createOrder({
        guestName: "Tom",
        toppings: [],
        sauces: ["none"],
        clientRequestId: "order-ffffffff",
      }),
    ).rejects.toThrow("pause");
  });

  it("blocks unavailable selected menu items", async () => {
    const store = createOrderStore();
    await store.setUnavailableItem("sauces", "ketchup", true);

    await expect(
      store.createOrder({
        guestName: "Tom",
        toppings: [],
        sauces: ["ketchup"],
        clientRequestId: "order-gggggggg",
      }),
    ).rejects.toThrow("Ketchup");

    const order = await store.createOrder({
      guestName: "Lina",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-hhhhhhhh",
    });
    expect(order.sauces).toEqual(["none"]);
  });

  it("keeps a per-order message thread between guest and kitchen", async () => {
    const store = createOrderStore();
    const order = await store.createOrder({
      guestName: "Mila",
      toppings: [],
      sauces: ["none"],
      clientRequestId: "order-iiiiiiii",
    });
    let messages = [];
    const unsubscribe = store.subscribeOrderMessages(order.id, (value) => {
      messages = value;
    });

    await store.sendOrderMessage(order.id, "Encore 5 min ?", "guest");
    await store.sendOrderMessage(order.id, "Oui, ca arrive.", "kitchen");

    expect(messages.map((message) => message.sender)).toEqual(["guest", "kitchen"]);
    expect(messages.map((message) => message.text)).toEqual(["Encore 5 min ?", "Oui, ca arrive."]);

    await store.updateStatus(order.id, "served");
    await expect(store.sendOrderMessage(order.id, "Merci", "guest")).rejects.toThrow("terminee");
    unsubscribe();
  });
});
