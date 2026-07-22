import {
  getSauceLabels,
  getToppingLabels,
  nachosOption,
  noSauceOption,
  sauceIds,
  sauces,
  toppings,
} from "../data/menu";
import { sessionId } from "./session";

export const CASHIER_SOURCE = "cashier";
export const cashierQueueStorageKey = `sarah-burger:${sessionId}:cashier-queue-v1`;

const toppingIds = toppings.map((item) => item.id);
const selectableSauceIds = [...sauceIds, noSauceOption.id];

function getDefaultStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function uniqueAllowed(ids, allowed) {
  const seen = new Set();
  const clean = [];

  for (const id of Array.isArray(ids) ? ids : []) {
    if (!allowed.includes(id) || seen.has(id)) continue;
    seen.add(id);
    clean.push(id);
  }

  return clean;
}

function generateSafeId(prefix = "cashier") {
  const randomId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;

  return `${prefix}-${randomId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

export function makeCashierClientRequestId() {
  return generateSafeId();
}

export function cleanCashierName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
}

export function normalizeCashierSauces(value) {
  const selected = uniqueAllowed(value, selectableSauceIds);
  if (selected.includes(noSauceOption.id)) return [noSauceOption.id];
  return selected.filter((id) => id !== noSauceOption.id);
}

export function normalizeCashierDraft(draft = {}) {
  const clientRequestId =
    typeof draft.clientRequestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(draft.clientRequestId)
      ? draft.clientRequestId
      : makeCashierClientRequestId();

  return {
    clientRequestId,
    guestName: cleanCashierName(draft.guestName),
    toppings: uniqueAllowed(draft.toppings, toppingIds),
    sauces: normalizeCashierSauces(draft.sauces),
    nachos: draft.nachos === true,
  };
}

export function createEmptyCashierDraft(overrides = {}) {
  return normalizeCashierDraft({
    clientRequestId: makeCashierClientRequestId(),
    guestName: "",
    toppings: [],
    sauces: [],
    nachos: false,
    ...overrides,
  });
}

export function toggleCashierTopping(selected, id) {
  if (!toppingIds.includes(id)) return uniqueAllowed(selected, toppingIds);
  const clean = uniqueAllowed(selected, toppingIds);
  return clean.includes(id) ? clean.filter((item) => item !== id) : [...clean, id];
}

export function toggleCashierSauce(selected, id) {
  if (!selectableSauceIds.includes(id)) return normalizeCashierSauces(selected);
  if (id === noSauceOption.id) return [noSauceOption.id];

  const withoutNone = normalizeCashierSauces(selected).filter((item) => item !== noSauceOption.id);
  return withoutNone.includes(id)
    ? withoutNone.filter((item) => item !== id)
    : [...withoutNone, id];
}

function isUnavailable(sessionMeta, group, id) {
  return sessionMeta?.unavailable?.[group]?.[id] === true;
}

export function getCashierDraftErrors(draft, sessionMeta = {}) {
  const normalized = normalizeCashierDraft(draft);
  const errors = [];

  if (!normalized.guestName) errors.push("Saisis le prenom.");
  if (normalized.sauces.length === 0) errors.push("Choisis une sauce ou Sans sauce.");

  for (const id of normalized.toppings) {
    if (isUnavailable(sessionMeta, "toppings", id)) {
      const label = toppings.find((item) => item.id === id)?.label || id;
      errors.push(`${label} n'est plus disponible.`);
    }
  }

  for (const id of normalized.sauces) {
    if (id !== noSauceOption.id && isUnavailable(sessionMeta, "sauces", id)) {
      const label = sauces.find((item) => item.id === id)?.label || id;
      errors.push(`${label} n'est plus disponible.`);
    }
  }

  if (normalized.nachos && isUnavailable(sessionMeta, "extras", nachosOption.id)) {
    errors.push(`${nachosOption.label} n'est plus disponible.`);
  }

  return errors;
}

export function assertValidCashierDraft(draft, sessionMeta = {}) {
  const errors = getCashierDraftErrors(draft, sessionMeta);
  if (errors.length > 0) throw new Error(errors[0]);
  return normalizeCashierDraft(draft);
}

export function buildCashierOrderInput(draft, sessionMeta = {}) {
  const normalized = assertValidCashierDraft(draft, sessionMeta);

  return {
    guestName: normalized.guestName,
    toppings: normalized.toppings,
    sauces: normalized.sauces,
    nachos: normalized.nachos,
    clientRequestId: normalized.clientRequestId,
    source: CASHIER_SOURCE,
  };
}

export function hasCashierDraftContent(draft) {
  const normalized = normalizeCashierDraft(draft);
  return Boolean(
    normalized.guestName ||
      normalized.toppings.length ||
      normalized.sauces.length ||
      normalized.nachos,
  );
}

export function describeCashierDraft(draft) {
  const normalized = normalizeCashierDraft(draft);
  const toppingsText = getToppingLabels(normalized.toppings).join(", ") || "Sans ajout";
  const saucesText = getSauceLabels(normalized.sauces).join(", ") || noSauceOption.label;
  const extraText = normalized.nachos ? nachosOption.label : "Sans nachos";

  return {
    ...normalized,
    toppingsText,
    saucesText,
    extraText,
  };
}

function normalizeQueueEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const draft = normalizeCashierDraft(entry.draft || entry);

  if (!draft.guestName || draft.sauces.length === 0) return null;

  return {
    id: draft.clientRequestId,
    clientRequestId: draft.clientRequestId,
    draft,
    createdAtMs: Number(entry.createdAtMs || Date.now()),
    updatedAtMs: Number(entry.updatedAtMs || entry.createdAtMs || Date.now()),
    attempts: Number(entry.attempts || 0),
    lastError: typeof entry.lastError === "string" ? entry.lastError : "",
  };
}

export function readCashierQueue(storage = getDefaultStorage()) {
  if (!storage) return [];

  try {
    const value = storage.getItem(cashierQueueStorageKey);
    const parsed = value ? JSON.parse(value) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeQueueEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeCashierQueue(entries, storage = getDefaultStorage()) {
  if (!storage) return;
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(normalizeQueueEntry)
    .filter(Boolean);

  if (normalized.length === 0) {
    storage.removeItem(cashierQueueStorageKey);
    return;
  }

  storage.setItem(cashierQueueStorageKey, JSON.stringify(normalized));
}

export function enqueueCashierDraft(draft, options = {}) {
  const storage = options.storage || getDefaultStorage();
  const now = options.now || Date.now;
  const normalized = assertValidCashierDraft(draft, options.sessionMeta);
  const queue = readCashierQueue(storage);
  const existingIndex = queue.findIndex((entry) => entry.clientRequestId === normalized.clientRequestId);
  const entry = {
    id: normalized.clientRequestId,
    clientRequestId: normalized.clientRequestId,
    draft: normalized,
    createdAtMs: queue[existingIndex]?.createdAtMs || now(),
    updatedAtMs: now(),
    attempts: queue[existingIndex]?.attempts || 0,
    lastError: queue[existingIndex]?.lastError || "",
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = entry;
  } else {
    queue.push(entry);
  }

  writeCashierQueue(queue, storage);
  return entry;
}

export function shouldQueueCashierError(error, isOnline = true) {
  if (!isOnline) return true;

  const message = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if (!message.trim()) return true;
  if (message.includes("archiv") || message.includes("pause") || message.includes("plus disponible")) return false;
  if (message.includes("permission")) return false;

  return (
    message.includes("connexion") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("timeout") ||
    message.includes("joignable") ||
    message.includes("firebase")
  );
}

export async function syncCashierQueue(store, options = {}) {
  const storage = options.storage || getDefaultStorage();
  const now = options.now || Date.now;
  const isOnline = options.isOnline ?? true;
  const queue = readCashierQueue(storage);
  const remaining = [];
  const synced = [];
  const failed = [];

  for (const entry of queue) {
    try {
      await store.createOrder(buildCashierOrderInput(entry.draft, options.sessionMeta));
      synced.push(entry);
    } catch (error) {
      const nextEntry = {
        ...entry,
        attempts: entry.attempts + 1,
        updatedAtMs: now(),
        lastError: error.message || "Synchronisation impossible.",
      };
      failed.push(nextEntry);
      remaining.push(nextEntry);

      if (!shouldQueueCashierError(error, isOnline)) {
        continue;
      }
    }
  }

  writeCashierQueue(remaining, storage);
  return { synced, failed, remaining };
}

export function isCashierOrder(order) {
  return order?.source === CASHIER_SOURCE;
}
