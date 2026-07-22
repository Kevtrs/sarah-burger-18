import { describe, expect, it, vi } from "vitest";
import {
  buildCashierOrderInput,
  cashierQueueStorageKey,
  enqueueCashierDraft,
  getCashierDraftErrors,
  getCashierSyncErrorMessage,
  isCashierOrder,
  readCashierQueue,
  shouldQueueCashierError,
  syncCashierQueue,
  toggleCashierSauce,
  writeCashierQueue,
} from "./cashierQueue";

function makeStorage() {
  const values = new Map();

  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  };
}

const validDraft = {
  clientRequestId: "cashier-test-0001",
  guestName: "Kevin",
  toppings: ["pickles"],
  sauces: ["bigmac"],
  nachos: true,
};

describe("cashier draft validation", () => {
  it("requires a guest name", () => {
    expect(getCashierDraftErrors({ ...validDraft, guestName: "" })).toContain("Saisis le prenom.");
  });

  it("allows several sauces", () => {
    const input = buildCashierOrderInput({
      ...validDraft,
      sauces: ["bigmac", "ketchup", "mayo"],
    });

    expect(input.sauces).toEqual(["bigmac", "ketchup", "mayo"]);
    expect(input.source).toBe("cashier");
  });

  it("keeps Sans sauce exclusive", () => {
    const first = toggleCashierSauce(["bigmac", "ketchup"], "none");
    const second = toggleCashierSauce(first, "mayo");

    expect(first).toEqual(["none"]);
    expect(second).toEqual(["mayo"]);
  });
});

describe("cashier offline queue", () => {
  it("persists queued orders across reloads", () => {
    const storage = makeStorage();

    enqueueCashierDraft(validDraft, { storage, now: () => 1000 });
    const afterReload = readCashierQueue(storage);

    expect(storage.setItem).toHaveBeenCalledWith(cashierQueueStorageKey, expect.any(String));
    expect(afterReload).toHaveLength(1);
    expect(afterReload[0].draft.guestName).toBe("Kevin");
    expect(afterReload[0].draft.clientRequestId).toBe(validDraft.clientRequestId);
  });

  it("updates the same queued order instead of duplicating it", () => {
    const storage = makeStorage();

    enqueueCashierDraft(validDraft, { storage, now: () => 1000 });
    enqueueCashierDraft({ ...validDraft, sauces: ["ketchup"] }, { storage, now: () => 2000 });

    const queue = readCashierQueue(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0].draft.sauces).toEqual(["ketchup"]);
    expect(queue[0].updatedAtMs).toBe(2000);
  });

  it("syncs queued orders through store.createOrder and clears successful entries", async () => {
    const storage = makeStorage();
    const store = {
      createOrder: vi.fn(async (input) => ({ id: input.clientRequestId, number: 42 })),
    };

    enqueueCashierDraft(validDraft, { storage, now: () => 1000 });
    const result = await syncCashierQueue(store, { storage, now: () => 2000 });
    const secondResult = await syncCashierQueue(store, { storage, now: () => 3000 });

    expect(result.synced).toHaveLength(1);
    expect(secondResult.synced).toHaveLength(0);
    expect(readCashierQueue(storage)).toEqual([]);
    expect(store.createOrder).toHaveBeenCalledTimes(1);
    expect(store.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestId: validDraft.clientRequestId,
      source: "cashier",
    }));
  });

  it("keeps failed sync entries with their stable clientRequestId", async () => {
    const storage = makeStorage();
    const store = {
      createOrder: vi.fn(async () => {
        throw new Error("Firebase n'est pas joignable pour le moment.");
      }),
    };

    enqueueCashierDraft(validDraft, { storage, now: () => 1000 });
    const result = await syncCashierQueue(store, { storage, now: () => 2000 });
    const queue = readCashierQueue(storage);

    expect(result.failed).toHaveLength(1);
    expect(queue).toHaveLength(1);
    expect(queue[0].clientRequestId).toBe(validDraft.clientRequestId);
    expect(queue[0].attempts).toBe(1);
  });

  it("detects network and permission errors as queueable", () => {
    expect(shouldQueueCashierError(new Error("Connexion indisponible."), true)).toBe(true);
    expect(shouldQueueCashierError(new Error("Permission denied"), true)).toBe(true);
    expect(getCashierSyncErrorMessage(new Error("PERMISSION_DENIED: Permission denied"))).toContain("regles Firebase");
  });
});

describe("cashier badge helper", () => {
  it("identifies cashier orders only", () => {
    expect(isCashierOrder({ source: "cashier" })).toBe(true);
    expect(isCashierOrder({ source: "guest" })).toBe(false);
    expect(isCashierOrder({})).toBe(false);
  });

  it("clears queue storage when it becomes empty", () => {
    const storage = makeStorage();
    writeCashierQueue([], storage);
    expect(storage.removeItem).toHaveBeenCalledWith(cashierQueueStorageKey);
  });
});
