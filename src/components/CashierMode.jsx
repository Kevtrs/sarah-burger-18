import {
  CheckCircle2,
  ClipboardPlus,
  Edit3,
  Eraser,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  ShoppingBag,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assetPath,
  baseBurger,
  nachosOption,
  noSauceOption,
  sauces,
  toppings,
} from "../data/menu";
import {
  assertValidCashierDraft,
  buildCashierOrderInput,
  createEmptyCashierDraft,
  describeCashierDraft,
  enqueueCashierDraft,
  hasCashierDraftContent,
  readCashierQueue,
  shouldQueueCashierError,
  syncCashierQueue,
  toggleCashierSauce,
  toggleCashierTopping,
} from "../services/cashierQueue";

function isUnavailable(sessionMeta, group, id) {
  return sessionMeta?.unavailable?.[group]?.[id] === true;
}

function normalizeCartItem(draft, localId = draft.clientRequestId) {
  const normalized = assertValidCashierDraft(draft);
  return { ...normalized, localId };
}

function QueueBadge({ entries, isSyncing }) {
  if (!entries.length) return null;

  return (
    <span className="cashier-sync-badge">
      {isSyncing ? <Loader2 className="spin" aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      {entries.length} en attente de synchronisation
    </span>
  );
}

export function CashierMode({ store, sessionMeta = {}, onClose }) {
  const [draft, setDraft] = useState(() => createEmptyCashierDraft());
  const [cart, setCart] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [queueEntries, setQueueEntries] = useState(() => readCashierQueue());

  const describedDraft = useMemo(() => describeCashierDraft(draft), [draft]);
  const canSend = cart.length > 0 || hasCashierDraftContent(draft);

  const refreshQueue = useCallback(() => {
    setQueueEntries(readCashierQueue());
  }, []);

  const retryQueue = useCallback(
    async ({ silent = false } = {}) => {
      if (isSyncing) return;

      setIsSyncing(true);
      if (!silent) setError("");

      try {
        const result = await syncCashierQueue(store, { isOnline, sessionMeta });
        refreshQueue();

        if (result.synced.length > 0) {
          setNotice(`${result.synced.length} commande(s) caisse synchronisee(s).`);
        }

        if (!silent && result.remaining.length > 0) {
          setError("Certaines commandes restent en attente de synchronisation.");
        }
      } catch (err) {
        if (!silent) setError(err.message || "Synchronisation impossible.");
      } finally {
        setIsSyncing(false);
      }
    },
    [isOnline, isSyncing, refreshQueue, sessionMeta, store],
  );

  useEffect(() => {
    const unsubscribeStore = store.subscribeConnection?.(setIsOnline);
    const handleOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);

    return () => {
      unsubscribeStore?.();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
    };
  }, [store]);

  useEffect(() => {
    refreshQueue();
    const handler = () => refreshQueue();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [refreshQueue]);

  useEffect(() => {
    if (!isOnline || queueEntries.length === 0 || isSyncing) return undefined;
    const timer = window.setTimeout(() => retryQueue({ silent: true }), 600);
    return () => window.clearTimeout(timer);
  }, [isOnline, isSyncing, queueEntries.length, retryQueue]);

  function updateDraft(updates) {
    setDraft((current) => ({ ...current, ...updates }));
    setError("");
    setNotice("");
  }

  function clearName() {
    updateDraft({ guestName: "" });
  }

  function toggleTopping(id) {
    if (isUnavailable(sessionMeta, "toppings", id)) return;
    updateDraft({ toppings: toggleCashierTopping(draft.toppings, id) });
  }

  function toggleSauce(id) {
    if (id !== noSauceOption.id && isUnavailable(sessionMeta, "sauces", id)) return;
    updateDraft({ sauces: toggleCashierSauce(draft.sauces, id) });
  }

  function toggleNachos() {
    if (isUnavailable(sessionMeta, "extras", nachosOption.id)) return;
    updateDraft({ nachos: !draft.nachos });
  }

  function resetDraft() {
    setDraft(createEmptyCashierDraft());
    setEditingId("");
    setError("");
    setNotice("");
  }

  function selectAllToppings() {
    updateDraft({
      toppings: toppings
        .filter((item) => !isUnavailable(sessionMeta, "toppings", item.id))
        .map((item) => item.id),
    });
  }

  function chooseClassicBurger() {
    updateDraft({ toppings: [], nachos: false });
  }

  function addToCart() {
    try {
      const item = normalizeCartItem(draft, editingId || draft.clientRequestId);
      setCart((current) =>
        editingId
          ? current.map((cartItem) => (cartItem.localId === editingId ? item : cartItem))
          : [...current, item],
      );
      setNotice(editingId ? "Burger modifie dans le panier caisse." : "Burger ajoute au panier caisse.");
      setDraft(createEmptyCashierDraft());
      setEditingId("");
      setError("");
    } catch (err) {
      setError(err.message || "Commande incomplete.");
    }
  }

  function editCartItem(item) {
    setDraft({ ...item });
    setEditingId(item.localId);
    setError("");
    setNotice("");
  }

  function removeCartItem(localId) {
    setCart((current) => current.filter((item) => item.localId !== localId));
  }

  function collectItemsToSend() {
    if (cart.length === 0) return [normalizeCartItem(draft, "current")];
    if (!hasCashierDraftContent(draft)) return cart;
    return [...cart, normalizeCartItem(draft, "current")];
  }

  async function submitOrders() {
    if (isSubmitting) return;

    let items;
    try {
      items = collectItemsToSend();
    } catch (err) {
      setError(err.message || "Commande incomplete.");
      return;
    }

    const processed = new Set();
    let sent = 0;
    let queued = 0;
    let fatalError = "";

    setIsSubmitting(true);
    setError("");
    setNotice("");

    for (const item of items) {
      try {
        await store.createOrder(buildCashierOrderInput(item, sessionMeta));
        processed.add(item.clientRequestId);
        sent += 1;
      } catch (err) {
        if (shouldQueueCashierError(err, isOnline)) {
          enqueueCashierDraft(item, { sessionMeta });
          processed.add(item.clientRequestId);
          queued += 1;
        } else {
          fatalError = err.message || "Commande caisse impossible a envoyer.";
          break;
        }
      }
    }

    setCart((current) => current.filter((item) => !processed.has(item.clientRequestId)));
    if (processed.has(draft.clientRequestId)) {
      setDraft(createEmptyCashierDraft());
      setEditingId("");
    }

    refreshQueue();
    setIsSubmitting(false);

    if (sent > 0 || queued > 0) {
      const parts = [];
      if (sent > 0) parts.push(`${sent} envoyee(s)`);
      if (queued > 0) parts.push(`${queued} en attente de synchronisation`);
      setNotice(parts.join(" - "));
    }

    if (fatalError) setError(fatalError);
  }

  function requestClose() {
    if ((cart.length > 0 || hasCashierDraftContent(draft)) && !window.confirm("Fermer le mode caisse sans enregistrer cette saisie ?")) {
      return;
    }
    onClose();
  }

  return (
    <div className="cashier-mode-backdrop" role="presentation">
      <section className="cashier-mode" role="dialog" aria-modal="true" aria-labelledby="cashier-title">
        <header className="cashier-mode__header">
          <button className="secondary-action compact" type="button" onClick={requestClose}>
            Retour aux commandes
          </button>
          <div>
            <p className="eyebrow">Secours cuisine</p>
            <h1 id="cashier-title">Mode caisse</h1>
            <p>Prends une commande orale et envoie-la dans la meme file que les telephones.</p>
          </div>
          <button className="modal-sheet__close" type="button" onClick={requestClose} aria-label="Fermer le mode caisse">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="cashier-mode__body">
          <section className="cashier-panel cashier-form-panel" aria-label="Nouvelle commande caisse">
            <div className="cashier-panel-title">
              <ClipboardPlus aria-hidden="true" />
              <div>
                <h2>{editingId ? "Modifier ce burger" : "Commande orale"}</h2>
                <small>Base incluse : {baseBurger.join(", ")}</small>
              </div>
            </div>

            {!isOnline && (
              <p className="notice notice-warning cashier-inline-notice">
                Connexion instable : les commandes seront gardees en attente.
              </p>
            )}
            {error && <p className="notice notice-error cashier-inline-notice">{error}</p>}
            {notice && <p className="notice notice-success cashier-inline-notice">{notice}</p>}

            <label className="field cashier-name-field">
              <span>Prenom</span>
              <div className="cashier-name-input">
                <input
                  value={draft.guestName}
                  autoComplete="off"
                  inputMode="text"
                  maxLength={32}
                  placeholder="Ex. Kevin"
                  onChange={(event) => updateDraft({ guestName: event.target.value })}
                />
                <button className="secondary-action compact" type="button" onClick={clearName}>
                  <Eraser aria-hidden="true" />
                  Effacer
                </button>
              </div>
            </label>

            <div className="cashier-shortcuts" aria-label="Raccourcis caisse">
              <button className="secondary-action compact" type="button" onClick={chooseClassicBurger}>
                Burger classique
              </button>
              <button className="secondary-action compact" type="button" onClick={selectAllToppings}>
                Tout selectionner
              </button>
              <button className="secondary-action compact" type="button" onClick={resetDraft}>
                <RotateCcw aria-hidden="true" />
                Reinitialiser
              </button>
            </div>

            <fieldset className="cashier-fieldset">
              <legend>Ajouts</legend>
              <div className="cashier-choice-grid">
                {toppings.map((item) => {
                  const selected = draft.toppings.includes(item.id);
                  const unavailable = isUnavailable(sessionMeta, "toppings", item.id);
                  return (
                    <button
                      className={`cashier-choice ${selected ? "is-selected" : ""} ${unavailable ? "is-unavailable" : ""}`}
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={unavailable}
                      onClick={() => toggleTopping(item.id)}
                    >
                      <img src={assetPath(item.asset)} alt="" aria-hidden="true" />
                      <span>{item.label}</span>
                      <small>{unavailable ? "Epuise" : selected ? "Ajoute" : item.note}</small>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="cashier-fieldset">
              <legend>Sauces</legend>
              <div className="cashier-choice-grid cashier-sauce-grid">
                {[...sauces, noSauceOption].map((item) => {
                  const selected = draft.sauces.includes(item.id);
                  const unavailable = item.id !== noSauceOption.id && isUnavailable(sessionMeta, "sauces", item.id);
                  return (
                    <button
                      className={`cashier-choice ${selected ? "is-selected" : ""} ${unavailable ? "is-unavailable" : ""}`}
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={unavailable}
                      onClick={() => toggleSauce(item.id)}
                    >
                      {item.asset ? (
                        <img src={assetPath(item.asset)} alt="" aria-hidden="true" />
                      ) : (
                        <span className="cashier-no-sauce-icon">SS</span>
                      )}
                      <span>{item.shortLabel || item.label}</span>
                      <small>{unavailable ? "Epuise" : selected ? "Choisie" : "Toucher pour choisir"}</small>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <button
              className={`cashier-nachos-card ${draft.nachos ? "is-selected" : ""}`}
              type="button"
              disabled={isUnavailable(sessionMeta, "extras", nachosOption.id)}
              aria-pressed={draft.nachos}
              onClick={toggleNachos}
            >
              <img src={assetPath(nachosOption.asset)} alt="" aria-hidden="true" />
              <span>
                <strong>{nachosOption.label}</strong>
                <small>{isUnavailable(sessionMeta, "extras", nachosOption.id) ? "Epuise" : nachosOption.note}</small>
              </span>
              {draft.nachos && <CheckCircle2 aria-hidden="true" />}
            </button>
          </section>

          <aside className="cashier-panel cashier-side-panel" aria-label="Panier caisse">
            <div className="cashier-panel-title">
              <ShoppingBag aria-hidden="true" />
              <div>
                <h2>Panier caisse</h2>
                <small>{cart.length ? `${cart.length} burger(s) pret(s) a envoyer` : "Ajoute plusieurs burgers si besoin"}</small>
              </div>
            </div>

            {cart.length === 0 ? (
              <p className="cashier-empty">Aucun burger ajoute. Tu peux envoyer directement le formulaire actuel.</p>
            ) : (
              <ul className="cashier-cart-list">
                {cart.map((item) => {
                  const described = describeCashierDraft(item);
                  return (
                    <li key={item.localId} className="cashier-cart-item">
                      <div>
                        <strong>{described.guestName}</strong>
                        <span>{described.toppingsText}</span>
                        <span>{described.saucesText}</span>
                        <small>{described.extraText}</small>
                      </div>
                      <div className="cashier-cart-actions">
                        <button className="secondary-action compact" type="button" onClick={() => editCartItem(item)}>
                          <Edit3 aria-hidden="true" />
                          Modifier
                        </button>
                        <button className="secondary-action compact" type="button" onClick={() => removeCartItem(item.localId)}>
                          <Trash2 aria-hidden="true" />
                          Supprimer
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="cashier-current-preview">
              <strong>Formulaire actuel</strong>
              <span>{describedDraft.guestName || "Prenom a saisir"}</span>
              <small>{describedDraft.saucesText}</small>
              {describedDraft.nachos && <small>{nachosOption.label}</small>}
            </div>

            <section className="cashier-queue-panel" aria-live="polite">
              <header>
                <QueueBadge entries={queueEntries} isSyncing={isSyncing} />
                {queueEntries.length > 0 && (
                  <button className="secondary-action compact" type="button" disabled={isSyncing} onClick={() => retryQueue()}>
                    {isSyncing ? <Loader2 className="spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                    Reessayer
                  </button>
                )}
              </header>
              {queueEntries.length > 0 && (
                <ul className="cashier-queue-list">
                  {queueEntries.map((entry) => {
                    const described = describeCashierDraft(entry.draft);
                    return (
                      <li key={entry.clientRequestId}>
                        <strong>{described.guestName}</strong>
                        <span>{described.saucesText}</span>
                        {entry.lastError && <small>{entry.lastError}</small>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>

        <footer className="cashier-mode__footer">
          <button className="secondary-action cashier-add-button" type="button" onClick={addToCart}>
            <Plus aria-hidden="true" />
            {editingId ? "Mettre a jour le panier" : "Ajouter et prendre une autre commande"}
          </button>
          <button
            className="primary-action cashier-submit-button"
            type="button"
            disabled={!canSend || isSubmitting}
            onClick={submitOrders}
          >
            {isSubmitting ? <Loader2 className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            Envoyer la commande
          </button>
        </footer>
      </section>
    </div>
  );
}
