import {
  CheckCircle2,
  Clock3,
  Flame,
  Archive,
  KeyRound,
  Loader2,
  LogOut,
  RotateCcw,
  ShieldCheck,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getSauceLabel,
  getToppingLabels,
  statusOrder,
  statuses,
} from "../data/menu";
import { useNewOrderSound } from "../hooks/useNewOrderSound";

const filters = [
  { id: "active", label: "En cours" },
  { id: "ready", label: "Prêtes" },
  { id: "served", label: "Servies" },
  { id: "cancelled", label: "Annulées" },
  { id: "all", label: "Toutes" },
];

export function KitchenDashboard({ store }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("active");
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(store.mode === "local");
  const [authChecked, setAuthChecked] = useState(store.mode === "local");
  const [sessionMeta, setSessionMeta] = useState({});
  const [ordersSnapshotReady, setOrdersSnapshotReady] = useState(false);
  const { soundEnabled, toggleSound } = useNewOrderSound(orders, {
    archived: Boolean(sessionMeta.archived),
    snapshotReady: ordersSnapshotReady,
  });

  useEffect(() => {
    if (!isUnlocked) return undefined;
    setOrdersSnapshotReady(false);
    return store.subscribeOrders(
      (nextOrders) => {
        setOrders(nextOrders);
        setOrdersSnapshotReady(true);
      },
      (err) => {
        setError(err.message || "Impossible de charger les commandes.");
      },
    );
  }, [isUnlocked, store]);

  useEffect(() => {
    if (store.mode === "local") return undefined;

    return store.subscribeAuth(
      async (user) => {
        if (!user || user.isAnonymous) {
          setIsUnlocked(false);
          setAuthChecked(true);
          return;
        }

        try {
          setIsUnlocked(await store.hasKitchenAccess(user.uid));
        } catch (err) {
          setError(err.message || "Impossible de vérifier l'accès cuisine.");
          setIsUnlocked(false);
        } finally {
          setAuthChecked(true);
        }
      },
      (err) => {
        setError(err.message || "Impossible de vérifier la connexion cuisine.");
        setAuthChecked(true);
      },
    );
  }, [store]);

  useEffect(() => {
    if (store.mode === "firebase" && !isUnlocked) return undefined;

    return store.subscribeSessionMeta?.(
      setSessionMeta,
      (err) => setError(err.message || "Impossible de suivre la session."),
    );
  }, [isUnlocked, store]);

  const counts = useMemo(() => {
    return orders.reduce(
      (acc, order) => {
        acc.total += 1;
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      },
      { total: 0, received: 0, preparing: 0, ready: 0, served: 0, cancelled: 0 },
    );
  }, [orders]);

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      if (filter === "all") return true;
      if (filter === "active") return order.status !== "served" && order.status !== "cancelled";
      return order.status === filter;
    });
  }, [filter, orders]);

  async function changeStatus(order, status) {
    setPendingId(order.id);
    setError("");
    try {
      await store.updateStatus(order.id, status);
    } catch (err) {
      setError(err.message || "Le statut n'a pas pu être changé.");
    } finally {
      setPendingId("");
    }
  }

  async function archiveSession() {
    const confirmed = window.confirm(
      "Archiver la session Sarah Burger ? Les invités ne pourront plus envoyer de nouvelles commandes.",
    );
    if (!confirmed) return;

    setPendingId("session");
    setError("");
    try {
      await store.archiveSession();
    } catch (err) {
      setError(err.message || "La session n'a pas pu être archivée.");
    } finally {
      setPendingId("");
    }
  }

  async function signOut() {
    await store.signOutKitchen?.();
    setIsUnlocked(false);
  }

  if (!authChecked) {
    return <p className="empty-state">Vérification de l&apos;accès cuisine...</p>;
  }

  if (!isUnlocked) {
    return <KitchenLoginGate store={store} onUnlock={() => setIsUnlocked(true)} />;
  }

  return (
    <main className="kitchen-layout">
      <section className="kitchen-hero">
        <div className="kitchen-hero-copy">
          <p className="eyebrow">Stand burgers</p>
          <h1>Commandes</h1>
          <p>La file en direct pour préparer sans ralentir le stand.</p>
        </div>
        <span className={`mode-pill mode-${store.mode}`}>
          <ShieldCheck aria-hidden="true" />
          {store.mode === "firebase" ? "Temps réel" : "Mode local"}
        </span>
        <button
          className="secondary-action compact"
          type="button"
          aria-pressed={soundEnabled}
          onClick={toggleSound}
        >
          {soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          {soundEnabled ? "Son activé" : "Son coupé"}
        </button>
        {sessionMeta.archived && <span className="status-pill status-blue">Session archivée</span>}
        <button
          className="secondary-action compact"
          type="button"
          onClick={archiveSession}
          disabled={pendingId === "session" || sessionMeta.archived}
        >
          <Archive aria-hidden="true" />
          Archiver
        </button>
        <button className="secondary-action compact" type="button" onClick={signOut}>
          <LogOut aria-hidden="true" />
          Sortir
        </button>
      </section>

      {error && <p className="notice notice-error">{error}</p>}

      <section className="stats-row" aria-label="Résumé des commandes">
        <Stat label="À préparer" value={counts.received} icon={<Clock3 aria-hidden="true" />} />
        <Stat label="En préparation" value={counts.preparing} icon={<Flame aria-hidden="true" />} />
        <Stat label="Prêtes" value={counts.ready} icon={<CheckCircle2 aria-hidden="true" />} />
      </section>

      <div className="filter-row" role="tablist" aria-label="Filtrer les commandes">
        {filters.map((item) => (
          <button
            className={filter === item.id ? "active" : ""}
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visibleOrders.length === 0 ? (
        <EmptyOrders filter={filter} />
      ) : (
        <section className="ticket-grid" aria-label="Liste des commandes">
          {visibleOrders.map((order) => (
            <OrderTicket
              key={order.id}
              order={order}
              isPending={pendingId === order.id}
              onChangeStatus={changeStatus}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function KitchenLoginGate({ store, onUnlock }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (store.mode === "local") {
        await store.signInKitchen();
      } else {
        await store.signInKitchen(email, password);
      }
      onUnlock();
    } catch (err) {
      setError(err.message || "Connexion cuisine impossible.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="pin-layout">
      <form className="pin-box" onSubmit={submit}>
        <KeyRound aria-hidden="true" />
        <h1>Accès cuisine</h1>
        {store.mode === "firebase" ? (
          <>
            <label className="field">
              <span>Email cuisine</span>
              <input
                value={email}
                autoComplete="username"
                type="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Mot de passe</span>
              <input
                value={password}
                autoComplete="current-password"
                type="password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <p className="muted">Mode local de développement. Aucune commande ne sort de cet appareil.</p>
        )}
        {error && <p className="notice notice-error">{error}</p>}
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
          Entrer en cuisine
        </button>
      </form>
    </main>
  );
}

function Stat({ label, value, icon }) {
  return (
    <article className="stat">
      {icon}
      <span>{value}</span>
      <small>{label}</small>
    </article>
  );
}

function EmptyOrders({ filter }) {
  const text =
    filter === "ready"
      ? "Aucun burger prêt pour le moment."
      : filter === "served"
        ? "Aucune commande servie."
        : filter === "cancelled"
          ? "Aucune commande annulée."
          : "Aucune commande en attente.";

  return <p className="empty-state">{text}</p>;
}

function OrderTicket({ order, isPending, onChangeStatus }) {
  const status = statuses[order.status] || statuses.received;
  const nextStatus = status.next;
  const previousStatus =
    order.status === "cancelled" ? null : statusOrder[statusOrder.indexOf(order.status) - 1];
  const toppingLabels = getToppingLabels(order.toppings);

  return (
    <article className={`ticket ticket-${status.color}`}>
      <header>
        <div>
          <span className="ticket-number">#{order.number}</span>
          <h2>{order.guestName}</h2>
        </div>
        <span className={`status-pill status-${status.color}`}>{status.kitchenLabel}</span>
      </header>

      <dl className="ticket-lines">
        <div>
          <dt>Ajouts</dt>
          <dd>{toppingLabels.length ? toppingLabels.join(", ") : "Sans ajout"}</dd>
        </div>
        <div>
          <dt>Sauce</dt>
          <dd>{getSauceLabel(order.sauce)}</dd>
        </div>
        <div>
          <dt>Reçue</dt>
          <dd>{formatTime(order.createdAtMs)}</dd>
        </div>
      </dl>

      <footer>
        {previousStatus && (
          <button
            className="secondary-action compact"
            type="button"
            onClick={() => onChangeStatus(order, previousStatus)}
            disabled={isPending}
          >
            <RotateCcw aria-hidden="true" />
            Revenir
          </button>
        )}
        {nextStatus && (
          <button
            className="primary-action compact"
            type="button"
            onClick={() => onChangeStatus(order, nextStatus)}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            {nextStatus === "preparing" ? "Préparer" : nextStatus === "ready" ? "Prête" : "Servie"}
          </button>
        )}
        {order.status !== "served" && order.status !== "cancelled" && (
          <button
            className="secondary-action compact"
            type="button"
            onClick={() => onChangeStatus(order, "cancelled")}
            disabled={isPending}
          >
            <XCircle aria-hidden="true" />
            Annuler
          </button>
        )}
      </footer>
    </article>
  );
}

function formatTime(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
