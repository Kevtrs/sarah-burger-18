import {
  ArrowLeft,
  Check,
  CheckCircle2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  assetPath,
  baseBurger,
  getSauceLabel,
  getToppingLabels,
  sauces,
  statuses,
  toppings,
} from "../data/menu";

const steps = ["identity", "customize", "review", "done"];
const progressLabels = ["Prénom", "Burger", "Validation"];
const introStorageKey = "sarah-burger-intro-seen";
const confettiColors = ["#e93668", "#f4c33f", "#d64023", "#1f6ec7", "#fffaf0"];
const confettiPieces = Array.from({ length: 24 }, (_, index) => {
  const side = index % 2 === 0 ? -1 : 1;
  const distance = 38 + ((index * 19) % 96);

  return {
    color: confettiColors[index % confettiColors.length],
    delay: `${(index % 8) * 18}ms`,
    rotate: `${(index * 47) % 320 - 160}deg`,
    x: `${side * distance}px`,
    y: `${-72 - ((index * 23) % 112)}px`,
  };
});

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function withViewTransition(update, transitionName) {
  if (
    typeof document === "undefined" ||
    prefersReducedMotion() ||
    !document.startViewTransition
  ) {
    update();
    return;
  }

  document.documentElement.dataset.transition = transitionName;
  const transition = document.startViewTransition(update);
  transition.finished.finally(() => {
    delete document.documentElement.dataset.transition;
  });
}

export function GuestOrder({ store }) {
  const [step, setStep] = useState("identity");
  const [guestName, setGuestName] = useState("");
  const [selectedToppings, setSelectedToppings] = useState([]);
  const [selectedSauce, setSelectedSauce] = useState("");
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState("idle");
  const [showConfetti, setShowConfetti] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [sessionMeta, setSessionMeta] = useState({});
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(introStorageKey) !== "yes";
  });
  const submitTimersRef = useRef([]);
  const clientRequestIdRef = useRef(crypto.randomUUID?.() || `order-${Date.now()}`);

  const selectedToppingLabels = useMemo(
    () => getToppingLabels(selectedToppings),
    [selectedToppings],
  );
  const selectedSauceLabel = useMemo(() => getSauceLabel(selectedSauce), [selectedSauce]);

  useEffect(() => {
    if (!order?.id) return undefined;
    return store.subscribeOrder(order.id, setOrder, (err) => {
      setError(err.message || "Impossible de suivre la commande.");
    });
  }, [order?.id, store]);

  useEffect(() => store.subscribeConnection?.(setIsOnline), [store]);

  useEffect(
    () =>
      store.subscribeSessionMeta?.(
        setSessionMeta,
        (err) => setError(err.message || "Impossible de suivre la session."),
      ),
    [store],
  );

  useEffect(() => {
    if (!showIntro) return undefined;

    const timer = window.setTimeout(() => {
      sessionStorage.setItem(introStorageKey, "yes");
      setShowIntro(false);
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [showIntro]);

  useEffect(
    () => () => {
      submitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  function clearSubmitTimers() {
    submitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    submitTimersRef.current = [];
  }

  function skipIntro() {
    sessionStorage.setItem(introStorageKey, "yes");
    setShowIntro(false);
  }

  function toggleTopping(id) {
    setSelectedToppings((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function canGoNext() {
    if (step === "identity") return guestName.trim().length > 0;
    if (step === "customize") return Boolean(selectedSauce);
    return true;
  }

  function goNext() {
    setError("");
    if (!canGoNext()) {
      setError(step === "identity" ? "Ajoute ton prénom avant de continuer." : "Choisis une sauce.");
      return;
    }
    const index = steps.indexOf(step);
    const nextStep = steps[index + 1];
    withViewTransition(() => flushSync(() => setStep(nextStep)), `${step}-to-${nextStep}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function goBack() {
    setError("");
    const index = steps.indexOf(step);
    if (index > 0) {
      const previousStep = steps[index - 1];
      withViewTransition(() => flushSync(() => setStep(previousStep)), `${step}-to-${previousStep}`);
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  async function submitOrder() {
    if (isSubmitting || submitState === "loading") return;
    if (sessionMeta.archived) {
      setError("La session de commandes est archivée.");
      setSubmitState("error");
      return;
    }
    if (!isOnline) {
      setError("Tu es hors ligne. Réessaie quand le réseau revient.");
      setSubmitState("error");
      return;
    }

    clearSubmitTimers();
    setIsSubmitting(true);
    setSubmitState("loading");
    setError("");

    try {
      const created = await store.createOrder({
        guestName,
        toppings: selectedToppings,
        sauce: selectedSauce,
        clientRequestId: clientRequestIdRef.current,
      });

      setSubmitState("success");
      setShowConfetti(true);

      const revealTimer = window.setTimeout(() => {
        withViewTransition(() => {
          flushSync(() => {
            setOrder(created);
            setStep("done");
          });
        }, "review-to-done");
        setIsSubmitting(false);
        setSubmitState("idle");
        window.scrollTo({ top: 0, behavior: "auto" });
      }, 760);

      const confettiTimer = window.setTimeout(() => {
        setShowConfetti(false);
      }, 980);

      submitTimersRef.current = [revealTimer, confettiTimer];
    } catch (err) {
      console.error("ORDER SUBMIT ERROR", err);
      setError(err.message || "La commande n'a pas pu être envoyée.");
      setSubmitState("error");
      setIsSubmitting(false);
    } finally {
      if (submitTimersRef.current.length === 0) setIsSubmitting(false);
    }
  }

  function reset() {
    clearSubmitTimers();
    withViewTransition(() => {
      flushSync(() => {
        setStep("identity");
        setGuestName("");
        setSelectedToppings([]);
        setSelectedSauce("");
        setOrder(null);
        setError("");
        setIsSubmitting(false);
        setSubmitState("idle");
        setShowConfetti(false);
        clientRequestIdRef.current = crypto.randomUUID?.() || `order-${Date.now()}`;
      });
    }, "done-to-identity");
  }

  function renderSubmitContent() {
    if (submitState === "loading") {
      return (
        <>
          <span className="cta-button__ingredients" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="cta-button__label">Préparation du ticket</span>
          <span className="cta-button__progress" aria-hidden="true" />
        </>
      );
    }

    if (submitState === "success") {
      return (
        <>
          <CheckCircle2 aria-hidden="true" />
          <span className="cta-button__label">Commande envoyée</span>
        </>
      );
    }

    if (submitState === "error") {
      return (
        <>
          <RotateCcw aria-hidden="true" />
          <span className="cta-button__label">Réessayer</span>
        </>
      );
    }

    return (
      <>
        <Send aria-hidden="true" />
        <span className="cta-button__label">Envoyer</span>
      </>
    );
  }

  return (
    <main className={`guest-layout stage-${step}`}>
      {showIntro && <SarahIntroSplash onSkip={skipIntro} />}
      {showConfetti && <ConfettiBurst />}
      <AmbientStickers />
      <Progress step={step} />
      {!isOnline && <InlineNotice tone="error">Connexion perdue. Réessaie quand le réseau revient.</InlineNotice>}
      {sessionMeta.archived && <InlineNotice tone="error">La session de commandes est archivée.</InlineNotice>}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {step === "identity" && (
        <section className="order-screen order-intro" aria-labelledby="intro-title">
          <div className="experience-hero">
            <div className="hero-copy">
              <p className="eyebrow">Le burger des 18 ans</p>
              <h1 id="intro-title">Bienvenue chez Sarah Burger</h1>
              <p>Compose ton cheeseburger collector, récupère ton numéro, puis profite de la soirée.</p>
              <div className="hero-tags" aria-hidden="true">
                <span>18 ans</span>
                <span>Cheddar club</span>
              </div>
            </div>

            <div className="hero-visual" aria-hidden="true">
              <span className="hero-badge">18</span>
              <img className="hero-sarah" src={assetPath("sarah-logo.svg")} alt="" />
              <img className="hero-burger" src={assetPath("menu-reference.svg")} alt="" />
              <img className="hero-mascot hero-mascot-left" src={assetPath("bigmac.svg")} alt="" />
            </div>
          </div>

          <div className="identity-panel">
            <label className="field">
              <span>Ton prénom</span>
              <input
                value={guestName}
                maxLength={32}
                autoComplete="given-name"
                placeholder="Ex. Sarah"
                onChange={(event) => setGuestName(event.target.value)}
              />
            </label>
            <div className="burger-preview" aria-label="Base du burger">
              <span className="base-badge">Base incluse</span>
              <img src={assetPath("menu-reference.svg")} alt="" aria-hidden="true" />
              <ul>
                {baseBurger.map((item) => (
                  <li key={item}>
                    <CheckCircle2 aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {step === "customize" && (
        <section className="order-screen customize-grid" aria-labelledby="customize-title">
          <div className="customize-title section-heading">
            <p className="eyebrow">Cheeseburger collector</p>
            <h1 id="customize-title">Compose ton burger</h1>
          </div>

          <div className="choice-section toppings-section">
            <div className="section-heading">
              <p className="eyebrow">Ajouts</p>
              <h2>Tes ajouts</h2>
            </div>
            <div className="choice-grid toppings-grid">
              {toppings.map((item) => {
                const selected = selectedToppings.includes(item.id);
                return (
                  <button
                    className={`option-card choice-card choice-${item.accent} mascot-${item.id} ${selected ? "selected" : ""}`}
                    key={item.id}
                    type="button"
                    data-option={item.id}
                    data-selected={selected}
                    onClick={() => toggleTopping(item.id)}
                    aria-pressed={selected}
                  >
                    <span className="option-card__shadow" aria-hidden="true" />
                    <span className="option-card__accent" aria-hidden="true" />
                    <span className="option-card__art choice-art">
                      <img src={assetPath(item.asset)} alt="" aria-hidden="true" />
                    </span>
                    <span className="option-card__content choice-copy">
                      <strong>{item.label}</strong>
                      <small>{item.note}</small>
                    </span>
                    <span className="option-card__control choice-check" aria-hidden="true">
                      <Check />
                    </span>
                    <span className="option-card__burst" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="choice-section sauces-section">
            <div className="section-heading">
              <p className="eyebrow">Sauce signature</p>
              <h2>Choisis ta sauce</h2>
            </div>
            <div className="choice-grid sauces-grid">
              {sauces.map((item) => {
                const selected = selectedSauce === item.id;
                return (
                  <button
                    className={`option-card sauce-card choice-${item.accent} mascot-${item.id} ${selected ? "selected" : ""}`}
                    key={item.id}
                    type="button"
                    data-option={item.id}
                    data-selected={selected}
                    onClick={() => setSelectedSauce(item.id)}
                    aria-pressed={selected}
                  >
                    <span className="option-card__shadow" aria-hidden="true" />
                    <span className="option-card__accent" aria-hidden="true" />
                    <span className="option-card__art choice-art">
                      <img src={assetPath(item.asset)} alt="" aria-hidden="true" />
                    </span>
                    <span className="option-card__content choice-copy">
                      <strong>{item.shortLabel}</strong>
                      <small>{item.label}</small>
                    </span>
                    <span className="option-card__control choice-check" aria-hidden="true">
                      <Check />
                    </span>
                    <span className="option-card__burst" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {step === "review" && (
        <section className="order-screen review-layout" aria-labelledby="review-title">
          <div className="review-copy">
            <p className="eyebrow">Dernière vérification</p>
            <h1 id="review-title">Ton ticket sort</h1>
            <p className="muted">Relis vite, puis envoie la commande au stand Sarah Burger.</p>
            <img src={assetPath("ketchup.svg")} alt="" aria-hidden="true" />
          </div>
          <OrderSummary
            guestName={guestName}
            toppings={selectedToppingLabels}
            sauce={selectedSauceLabel}
            submitState={submitState}
          />
        </section>
      )}

      {step === "done" && order && (
        <section className="order-screen done-layout success-scene" aria-labelledby="done-title" aria-live="polite">
          <div className="success-copy">
            <p className="eyebrow">Ticket validé</p>
            <h1 id="done-title">Commande envoyée</h1>
          </div>
          <div className="number-stage success-number-wrap" aria-label={`Numéro de commande ${order.number}`}>
            <span className="success-number__burst" aria-hidden="true" />
            <img className="success-mascot success-mascot-left" src={assetPath("bigmac.svg")} alt="" aria-hidden="true" />
            <span className="order-number success-number">#{order.number}</span>
            <img className="success-mascot success-mascot-right" src={assetPath("onions.svg")} alt="" aria-hidden="true" />
          </div>
          <p className="success-note muted">Ta commande entre en cuisine. Garde bien ton numéro.</p>
          <div className="success-ticket" aria-hidden="true">
            <span>SARAH BURGER</span>
            <strong>#{order.number}</strong>
            <small>{guestName || order.guestName}</small>
          </div>
          <StatusPill status={order.status} />
          {order.status === "ready" && (
            <InlineNotice tone="success">Ton burger est prêt au stand.</InlineNotice>
          )}
        </section>
      )}

      <div className="sticky-actions">
        {step !== "identity" && step !== "done" && (
          <button className="secondary-action cta-button cta-secondary" type="button" onClick={goBack}>
            <span className="cta-button__base" aria-hidden="true" />
            <span className="cta-button__shine" aria-hidden="true" />
            <ArrowLeft aria-hidden="true" />
            Retour
          </button>
        )}

        {step === "review" ? (
          <button
            className={`primary-action cta-button submit-action submit-${submitState}`}
            type="button"
            data-state={submitState}
            onClick={submitOrder}
            disabled={
              isSubmitting ||
              submitState === "loading" ||
              submitState === "success" ||
              sessionMeta.archived
            }
          >
            <span className="cta-button__base" aria-hidden="true" />
            <span className="cta-button__shine" aria-hidden="true" />
            {renderSubmitContent()}
          </button>
        ) : step === "done" ? (
          <button className="primary-action cta-button" type="button" onClick={reset}>
            <span className="cta-button__base" aria-hidden="true" />
            <span className="cta-button__shine" aria-hidden="true" />
            <Sparkles aria-hidden="true" />
            Nouvelle commande
          </button>
        ) : (
          <button className="primary-action cta-button" type="button" onClick={goNext}>
            <span className="cta-button__base" aria-hidden="true" />
            <span className="cta-button__shine" aria-hidden="true" />
            Continuer
          </button>
        )}
      </div>
    </main>
  );
}

function AmbientStickers() {
  return (
    <div className="ambient-stickers" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function SarahIntroSplash({ onSkip }) {
  return (
    <div className="intro-splash intro-backdrop">
      <div className="intro-splash-card" aria-hidden="true">
        <img className="intro-logo logo-stamp" src={assetPath("sarah-logo.svg")} alt="" />
        <img className="intro-burger" src={assetPath("menu-reference.svg")} alt="" />
        <img className="intro-mascot intro-mascot-a" src={assetPath("bigmac.svg")} alt="" />
        <img className="intro-mascot intro-mascot-b" src={assetPath("jalapeno.svg")} alt="" />
        <p className="intro-tagline">Le Burger des 18 ans</p>
      </div>
      <button className="intro-skip" type="button" onClick={onSkip}>
        <X aria-hidden="true" />
        Passer
      </button>
    </div>
  );
}

function Progress({ step }) {
  const activeIndex = steps.indexOf(step);
  if (step === "done") return null;

  return (
    <ol className="progress" aria-label="Progression de commande">
      {progressLabels.map((label, index) => {
        const state = index < activeIndex ? "completed" : index === activeIndex ? "current" : "future";
        return (
          <li className={state} key={label}>
            <span className="step-dot" aria-hidden="true">
              {state === "completed" ? <Check /> : index + 1}
            </span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ConfettiBurst() {
  return (
    <div className="confetti-burst" aria-hidden="true">
      {confettiPieces.map((piece, index) => (
        <span
          key={`${piece.color}-${index}`}
          style={{
            "--confetti-color": piece.color,
            "--confetti-delay": piece.delay,
            "--confetti-rotate": piece.rotate,
            "--confetti-x": piece.x,
            "--confetti-y": piece.y,
          }}
        />
      ))}
    </div>
  );
}

function OrderSummary({ guestName, toppings: toppingLabels, sauce, submitState }) {
  const stamp = submitState === "success" ? "Validé" : "À confirmer";
  const now = new Date();
  const ticketDate = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(now);
  const ticketTime = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const safeName = guestName.trim().slice(0, 3).toUpperCase() || "SB";
  const code = `${safeName}-${sauce.slice(0, 2).toUpperCase()}${toppingLabels.length + 1}`;

  return (
    <div className={`ticket-machine ticket-printer ticket-${submitState}`}>
      <div className="printer-slot ticket-slot" aria-hidden="true" />
      <article className="summary-list order-ticket">
        <header className="order-ticket__header">
          <strong>SARAH BURGER</strong>
          <span>Commande à confirmer</span>
        </header>
        <span className="ticket-stamp">{stamp}</span>
        <div className="order-ticket__meta">
          <span>{ticketDate}</span>
          <span>{ticketTime}</span>
          <span>{code}</span>
        </div>
        <dl>
          <div>
            <dt>Prénom</dt>
            <dd>{guestName}</dd>
          </div>
          <div>
            <dt>Base</dt>
            <dd>{baseBurger.join(", ")}</dd>
          </div>
          <div>
            <dt>Ajouts</dt>
            <dd>{toppingLabels.length ? toppingLabels.join(", ") : "Sans ajout"}</dd>
          </div>
          <div>
            <dt>Sauce</dt>
            <dd>{sauce}</dd>
          </div>
        </dl>
      </article>
    </div>
  );
}

function StatusPill({ status }) {
  const current = statuses[status] || statuses.received;
  return <span className={`status-pill status-${current.color}`}>{current.label}</span>;
}

function InlineNotice({ tone, children }) {
  return <p className={`notice notice-${tone}`}>{children}</p>;
}
