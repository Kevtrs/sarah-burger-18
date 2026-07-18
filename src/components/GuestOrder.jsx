import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  MessageCircle,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  assetPath,
  baseBurger,
  getSauceLabels,
  getToppingLabels,
  nachosOption,
  noSauceOption,
  sauces,
  statuses,
  toppings,
} from "../data/menu";
import { useReadyOrderAlert } from "../hooks/useReadyOrderAlert";
import { useOrderQueue } from "../hooks/useOrderQueue";
import { usePickupAcks } from "../hooks/usePickupAcks";
import { OrderMessages } from "./OrderMessages";

const steps = ["identity", "customize", "nachos", "review", "done"];
const progressLabels = ["Prénom", "Burger", "Nachos", "Ticket"];
const introStorageKey = "sarah-burger-intro-seen";
const sionsContractStoragePrefix = "sarah-burger-sions-contract-signed-v1";
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

function makeClientRequestId() {
  return crypto.randomUUID?.() || `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUnavailable(sessionMeta, group, id) {
  return sessionMeta?.unavailable?.[group]?.[id] === true;
}

function unavailableLabelsForDraft(draft, sessionMeta) {
  const labels = [];

  for (const item of toppings) {
    if (draft.toppings?.includes(item.id) && isUnavailable(sessionMeta, "toppings", item.id)) {
      labels.push(item.label);
    }
  }

  for (const item of sauces) {
    if (draft.sauces?.includes(item.id) && isUnavailable(sessionMeta, "sauces", item.id)) {
      labels.push(item.label);
    }
  }

  if (draft.nachos && isUnavailable(sessionMeta, "extras", nachosOption.id)) {
    labels.push(nachosOption.label);
  }

  return labels;
}

function normalizeFunName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function isSarahVipName(value) {
  return normalizeFunName(value) === "sarah";
}

function isUncleCodName(value) {
  const normalized = normalizeFunName(value);
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, "");
  const tokens = normalized.split(" ").filter(Boolean);
  const variants = new Set(["karail", "cedric", "cedrick", "cedrik", "ced", "dric", "c"]);

  return variants.has(compact) || tokens.some((token) => variants.has(token));
}

function isVeherOmName(value) {
  const normalized = normalizeFunName(value);
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, "");
  const tokens = normalized.split(" ").filter(Boolean);
  return compact === "veher" || compact === "veherlive" || tokens.includes("veher");
}

function sionsContractStorageKey(orderId) {
  return `${sionsContractStoragePrefix}:${orderId}`;
}

function hasSignedSionsContract(orderId) {
  if (typeof window === "undefined" || !orderId) return false;
  return window.localStorage.getItem(sionsContractStorageKey(orderId)) === "yes";
}

export function GuestOrder({ store }) {
  const [step, setStep] = useState("identity");
  const [guestName, setGuestName] = useState("");
  const [selectedToppings, setSelectedToppings] = useState([]);
  const [selectedSauces, setSelectedSauces] = useState([]);
  const [wantsNachos, setWantsNachos] = useState(false);
  const [hasAnsweredNachos, setHasAnsweredNachos] = useState(false);
  const [cart, setCart] = useState([]);
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
  const [isAddBurgerOpen, setIsAddBurgerOpen] = useState(false);
  const [showGroupPrompt, setShowGroupPrompt] = useState(false);
  const [sionsContractOrder, setSionsContractOrder] = useState(null);
  const submitTimersRef = useRef([]);
  const clientRequestIdRef = useRef(makeClientRequestId());
  const hasResumedOrderRef = useRef(false);
  const hasShownGroupPromptRef = useRef(false);
  const groupPromptTimerRef = useRef(null);
  const readyAlert = useReadyOrderAlert(store);
  const orderQueue = useOrderQueue(store, readyAlert.trackedOrders);
  const pickupAcks = usePickupAcks(store, readyAlert.trackedOrders);

  const trimmedName = guestName.trim();
  const isDuplicateName = useMemo(
    () =>
      trimmedName.length > 0 &&
      cart.some((item) => item.guestName.trim().toLowerCase() === trimmedName.toLowerCase()),
    [cart, trimmedName],
  );

  const selectedToppingLabels = useMemo(
    () => getToppingLabels(selectedToppings),
    [selectedToppings],
  );
  const selectedSauceLabels = useMemo(() => getSauceLabels(selectedSauces), [selectedSauces]);

  useEffect(() => {
    if (hasResumedOrderRef.current || step !== "identity" || readyAlert.trackedOrders.length === 0) return;

    hasResumedOrderRef.current = true;
    sessionStorage.setItem(introStorageKey, "yes");
    setShowIntro(false);
    setStep("done");
  }, [step, readyAlert.trackedOrders]);

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
    setSelectedToppings((current) =>
      current.filter((id) => !isUnavailable(sessionMeta, "toppings", id)),
    );
    setSelectedSauces((current) =>
      current.filter((id) => id === noSauceOption.id || !isUnavailable(sessionMeta, "sauces", id)),
    );
    if (isUnavailable(sessionMeta, "extras", nachosOption.id)) {
      setWantsNachos(false);
      setHasAnsweredNachos(true);
    }
    setCart((current) =>
      current.map((item) => ({
        ...item,
        toppings: item.toppings.filter((id) => !isUnavailable(sessionMeta, "toppings", id)),
        sauces: item.sauces.filter((id) => id === noSauceOption.id || !isUnavailable(sessionMeta, "sauces", id)),
        nachos: item.nachos && !isUnavailable(sessionMeta, "extras", nachosOption.id),
      })),
    );
  }, [sessionMeta]);

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
      if (groupPromptTimerRef.current) window.clearTimeout(groupPromptTimerRef.current);
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
    if (isUnavailable(sessionMeta, "toppings", id)) return;
    setSelectedToppings((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleSauce(id) {
    if (id !== noSauceOption.id && isUnavailable(sessionMeta, "sauces", id)) return;
    setSelectedSauces((current) => {
      if (id === noSauceOption.id) return [noSauceOption.id];
      const withoutNone = current.filter((item) => item !== noSauceOption.id);
      return withoutNone.includes(id)
        ? withoutNone.filter((item) => item !== id)
        : [...withoutNone, id];
    });
  }

  function chooseNachos(value) {
    if (value && isUnavailable(sessionMeta, "extras", nachosOption.id)) return;
    setWantsNachos(value);
    setHasAnsweredNachos(true);
    setError("");
  }

  function canGoNext() {
    if (step === "identity") return guestName.trim().length > 0;
    if (step === "customize") return selectedSauces.length > 0;
    if (step === "nachos") return hasAnsweredNachos || isUnavailable(sessionMeta, "extras", nachosOption.id);
    return true;
  }

  function nextErrorMessage() {
    if (step === "identity") return "Ajoute ton prénom avant de continuer.";
    if (step === "customize") return "Choisis une sauce ou Sans sauce.";
    if (step === "nachos") return "Choisis Oui ou Non pour la barquette de nachos.";
    return "";
  }

  function nextButtonLabel() {
    if (step === "customize") return "Choisir les nachos";
    if (step === "nachos") return "Voir le ticket";
    return "Continuer";
  }

  function goNext() {
    setError("");
    if (!canGoNext()) {
      setError(nextErrorMessage());
      return;
    }
    const index = steps.indexOf(step);
    const nextStep = steps[index + 1];
    withViewTransition(() => flushSync(() => setStep(nextStep)), `${step}-to-${nextStep}`);
    window.scrollTo({ top: 0, behavior: "auto" });

    if (nextStep === "review" && !hasShownGroupPromptRef.current && cart.length === 0) {
      hasShownGroupPromptRef.current = true;
      groupPromptTimerRef.current = window.setTimeout(() => {
        setShowGroupPrompt(true);
      }, 650);
    }
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

  function openAddBurgerModal() {
    setError("");
    setShowGroupPrompt(false);
    setIsAddBurgerOpen(true);
  }

  function dismissGroupPrompt() {
    setShowGroupPrompt(false);
  }

  function closeAddBurgerModal() {
    setIsAddBurgerOpen(false);
  }

  function confirmAddBurger(draft) {
    const id = makeClientRequestId();
    setCart((current) => [...current, { localId: id, clientRequestId: id, ...draft }]);
    setIsAddBurgerOpen(false);
  }

  function removeFromCart(localId) {
    setCart((current) => current.filter((item) => item.localId !== localId));
  }

  async function submitAll() {
    if (isSubmitting || submitState === "loading") return;
    if (sessionMeta.archived) {
      setError("La session de commandes est archivée.");
      setSubmitState("error");
      return;
    }
    if (sessionMeta.paused) {
      setError("Le stand est en pause. Reessaie dans quelques minutes.");
      setSubmitState("error");
      return;
    }
    if (!isOnline) {
      setError("Tu es hors ligne. Réessaie quand le réseau revient.");
      setSubmitState("error");
      return;
    }

    const items = [
      ...cart,
      {
        localId: "current",
        clientRequestId: clientRequestIdRef.current,
        guestName,
        toppings: selectedToppings,
        sauces: selectedSauces,
        nachos: wantsNachos,
      },
    ];

    const unavailableLabels = [...new Set(items.flatMap((item) => unavailableLabelsForDraft(item, sessionMeta)))];
    if (unavailableLabels.length) {
      setError(`${unavailableLabels.join(", ")} n'est plus disponible.`);
      setSubmitState("error");
      return;
    }

    clearSubmitTimers();
    setIsSubmitting(true);
    setSubmitState("loading");
    setError("");

    try {
      await readyAlert.enableAlerts({ silent: true });

      const createdOrders = [];
      for (const item of items) {
        const created = await store.createOrder({
          guestName: item.guestName,
          toppings: item.toppings,
          sauces: item.sauces,
          nachos: item.nachos,
          clientRequestId: item.clientRequestId,
        });
        readyAlert.trackOrder(created);
        createdOrders.push(created);
      }

      const prankOrder = createdOrders.find(
        (order) => isUncleCodName(order.guestName) && !hasSignedSionsContract(order.id),
      );

      setCart([]);
      setSubmitState("success");
      setShowConfetti(true);

      const revealTimer = window.setTimeout(() => {
        withViewTransition(() => {
          flushSync(() => {
            setStep("done");
          });
        }, "review-to-done");
        setIsSubmitting(false);
        setSubmitState("idle");
        if (prankOrder) setSionsContractOrder(prankOrder);
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
    readyAlert.clearTrackedOrders();
    setSionsContractOrder(null);
    hasShownGroupPromptRef.current = false;
    if (groupPromptTimerRef.current) {
      window.clearTimeout(groupPromptTimerRef.current);
      groupPromptTimerRef.current = null;
    }
    withViewTransition(() => {
      flushSync(() => {
        setStep("identity");
        setGuestName("");
        setSelectedToppings([]);
        setSelectedSauces([]);
        setWantsNachos(false);
        setHasAnsweredNachos(false);
        setCart([]);
        setError("");
        setIsSubmitting(false);
        setSubmitState("idle");
        setShowConfetti(false);
        setShowGroupPrompt(false);
        clientRequestIdRef.current = makeClientRequestId();
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
        <span className="cta-button__label">{cart.length ? `Envoyer ${cart.length + 1} commandes` : "Envoyer"}</span>
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
      {sessionMeta.paused && <InlineNotice tone="warning">Le stand est en pause. Tu peux regarder le menu, mais l&apos;envoi est bloque.</InlineNotice>}
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

          <ToppingsGrid selectedToppings={selectedToppings} onToggle={toggleTopping} unavailable={sessionMeta.unavailable} />
          <SaucesGrid selectedSauces={selectedSauces} onToggle={toggleSauce} unavailable={sessionMeta.unavailable} />
        </section>
      )}

      {step === "nachos" && (
        <NachosStep
          guestName={trimmedName}
          toppingLabels={selectedToppingLabels}
          sauceLabels={selectedSauceLabels}
          selectedChoice={hasAnsweredNachos ? (wantsNachos ? "yes" : "no") : null}
          unavailable={sessionMeta.unavailable}
          onChoose={chooseNachos}
        />
      )}

      {step === "review" && (
        <section className="order-screen review-layout" aria-labelledby="review-title">
          <div className="review-copy">
            <p className="eyebrow">Dernière vérification</p>
            <h1 id="review-title">Ton ticket sort</h1>
            <p className="muted">Relis vite, puis envoie la commande au stand Sarah Burger.</p>
            <img src={assetPath("ketchup.svg")} alt="" aria-hidden="true" />
          </div>
          <div className="review-panel">
            {cart.length > 0 && <CartList cart={cart} onRemove={removeFromCart} />}
            <OrderSummary
              guestName={guestName}
              toppings={selectedToppingLabels}
              sauces={selectedSauceLabels}
              nachos={wantsNachos}
              submitState={submitState}
            />
            {isDuplicateName && (
              <InlineNotice tone="warning">
                Il y a déjà un burger pour « {trimmedName} » dans cette commande.
              </InlineNotice>
            )}
            {submitState !== "loading" && submitState !== "success" && (
              <button className="secondary-action add-burger-button" type="button" onClick={openAddBurgerModal}>
                <UserPlus aria-hidden="true" />
                Ajouter un burger pour quelqu&apos;un d&apos;autre
              </button>
            )}
          </div>
        </section>
      )}

      {showGroupPrompt && (
        <GroupOrderPrompt onAddBurger={openAddBurgerModal} onDismiss={dismissGroupPrompt} />
      )}

      {isAddBurgerOpen && (
        <AddBurgerModal
          existingNames={[guestName, ...cart.map((item) => item.guestName)]}
          unavailable={sessionMeta.unavailable}
          onCancel={closeAddBurgerModal}
          onConfirm={confirmAddBurger}
        />
      )}

      {sionsContractOrder && (
        <SionsContractModal
          order={sionsContractOrder}
          onSign={() => {
            window.localStorage.setItem(sionsContractStorageKey(sionsContractOrder.id), "yes");
            setSionsContractOrder(null);
          }}
        />
      )}

      {step === "done" && readyAlert.trackedOrders.length > 0 && (
        readyAlert.trackedOrders.length === 1 ? (
          <SingleDoneScreen
            entry={readyAlert.trackedOrders[0]}
            orderQueue={orderQueue}
            pickupAcks={pickupAcks}
            readyAlert={readyAlert}
            store={store}
          />
        ) : (
          <GroupDoneScreen
            orderQueue={orderQueue}
            orders={readyAlert.trackedOrders}
            pickupAcks={pickupAcks}
            readyAlert={readyAlert}
            store={store}
          />
        )
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
            onClick={submitAll}
            disabled={
              isSubmitting ||
              submitState === "loading" ||
              submitState === "success" ||
              sessionMeta.archived ||
              sessionMeta.paused
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
            {nextButtonLabel()}
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

function ToppingsGrid({ selectedToppings, onToggle, unavailable = {} }) {
  return (
    <div className="choice-section toppings-section">
      <div className="section-heading">
        <p className="eyebrow">Ajouts</p>
        <h2>Tes ajouts</h2>
      </div>
      <div className="choice-grid toppings-grid">
        {toppings.map((item) => {
          const selected = selectedToppings.includes(item.id);
          const blocked = unavailable.toppings?.[item.id] === true;
          return (
            <button
              className={`option-card choice-card choice-${item.accent} mascot-${item.id} ${selected ? "selected" : ""} ${blocked ? "is-unavailable" : ""}`}
              key={item.id}
              type="button"
              data-option={item.id}
              data-selected={selected}
              data-unavailable={blocked}
              disabled={blocked}
              onClick={() => onToggle(item.id)}
              aria-pressed={selected}
            >
              <span className="option-card__shadow" aria-hidden="true" />
              <span className="option-card__accent" aria-hidden="true" />
              <span className="option-card__art choice-art">
                <img src={assetPath(item.asset)} alt="" aria-hidden="true" />
              </span>
              <span className="option-card__content choice-copy">
                <strong>{item.label}</strong>
                <small>{blocked ? "Epuise pour le moment" : item.note}</small>
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
  );
}

function SaucesGrid({ selectedSauces, onToggle, unavailable = {} }) {
  return (
    <div className="choice-section sauces-section">
      <div className="section-heading">
        <p className="eyebrow">Sauce signature</p>
        <h2>Choisis tes sauces</h2>
      </div>
      <div className="choice-grid sauces-grid">
        <button
          className={`option-card sauce-card no-sauce-card choice-blue mascot-none ${
            selectedSauces.includes(noSauceOption.id) ? "selected" : ""
          }`}
          type="button"
          data-option={noSauceOption.id}
          data-selected={selectedSauces.includes(noSauceOption.id)}
          onClick={() => onToggle(noSauceOption.id)}
          aria-pressed={selectedSauces.includes(noSauceOption.id)}
        >
          <span className="option-card__shadow" aria-hidden="true" />
          <span className="option-card__accent" aria-hidden="true" />
          <span className="option-card__art choice-art no-sauce-art">
            <X aria-hidden="true" />
          </span>
          <span className="option-card__content choice-copy">
            <strong>{noSauceOption.shortLabel}</strong>
            <small>Cheeseburger nature</small>
          </span>
          <span className="option-card__control choice-check" aria-hidden="true">
            <Check />
          </span>
          <span className="option-card__burst" aria-hidden="true" />
        </button>
        {sauces.map((item) => {
          const selected = selectedSauces.includes(item.id);
          const blocked = unavailable.sauces?.[item.id] === true;
          return (
            <button
              className={`option-card sauce-card choice-${item.accent} mascot-${item.id} ${selected ? "selected" : ""} ${blocked ? "is-unavailable" : ""}`}
              key={item.id}
              type="button"
              data-option={item.id}
              data-selected={selected}
              data-unavailable={blocked}
              disabled={blocked}
              onClick={() => onToggle(item.id)}
              aria-pressed={selected}
            >
              <span className="option-card__shadow" aria-hidden="true" />
              <span className="option-card__accent" aria-hidden="true" />
              <span className="option-card__art choice-art">
                <img src={assetPath(item.asset)} alt="" aria-hidden="true" />
              </span>
              <span className="option-card__content choice-copy">
                <strong>{item.shortLabel}</strong>
                <small>{blocked ? "Epuisee" : item.label}</small>
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
  );
}

function NachosOption({ selected, onToggle, unavailable = {} }) {
  const blocked = unavailable.extras?.[nachosOption.id] === true;

  return (
    <div className="choice-section nachos-section">
      <div className="section-heading">
        <p className="eyebrow">Accompagnement</p>
        <h2>Envie d&apos;un extra ?</h2>
      </div>
      <div className="choice-grid nachos-grid">
        <button
          className={`option-card choice-card choice-gold mascot-nachos ${selected ? "selected" : ""} ${blocked ? "is-unavailable" : ""}`}
          type="button"
          data-option={nachosOption.id}
          data-selected={selected}
          data-unavailable={blocked}
          disabled={blocked}
          onClick={onToggle}
          aria-pressed={selected}
        >
          <span className="option-card__shadow" aria-hidden="true" />
          <span className="option-card__accent" aria-hidden="true" />
          <span className="option-card__art choice-art">
            <img src={assetPath(nachosOption.asset)} alt="" aria-hidden="true" />
          </span>
          <span className="option-card__content choice-copy">
            <strong>{nachosOption.label}</strong>
            <small>{blocked ? "Epuise pour le moment" : nachosOption.note}</small>
          </span>
          <span className="option-card__control choice-check" aria-hidden="true">
            <Check />
          </span>
          <span className="option-card__burst" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function NachosStep({ guestName, toppingLabels, sauceLabels, selectedChoice, onChoose, unavailable = {} }) {
  const blocked = unavailable.extras?.[nachosOption.id] === true;
  const yesSelected = selectedChoice === "yes";
  const noSelected = selectedChoice === "no" || blocked;
  const toppingsText = toppingLabels.length ? toppingLabels.join(", ") : "Sans ajout";
  const saucesText = sauceLabels.length ? sauceLabels.join(", ") : noSauceOption.label;

  return (
    <section className="order-screen nachos-layout" aria-labelledby="nachos-title">
      <div className="section-heading nachos-heading">
        <p className="eyebrow">Avant le ticket</p>
        <h1 id="nachos-title">Barquette de nachos ?</h1>
        <p className="muted">Dernière question, puis ton ticket part au stand.</p>
      </div>

      <div className="nachos-recap">
        <strong>{guestName}</strong>
        <span>
          {toppingsText} · {saucesText}
        </span>
      </div>

      <div className="nachos-spotlight" aria-hidden="true">
        <img src={assetPath(nachosOption.asset)} alt="" />
        <span>+ extra</span>
      </div>

      <div className="nachos-decision-grid" role="group" aria-label="Choix de barquette de nachos">
        <button
          className={`option-card nachos-choice-card choice-gold mascot-nachos ${yesSelected ? "selected" : ""} ${blocked ? "is-unavailable" : ""}`}
          type="button"
          data-selected={yesSelected}
          data-unavailable={blocked}
          disabled={blocked}
          onClick={() => onChoose(true)}
          aria-pressed={yesSelected}
        >
          <span className="option-card__shadow" aria-hidden="true" />
          <span className="option-card__accent" aria-hidden="true" />
          <span className="option-card__art choice-art">
            <img src={assetPath(nachosOption.asset)} alt="" aria-hidden="true" />
          </span>
          <span className="option-card__content choice-copy">
            <strong>Oui, barquette</strong>
            <small>{blocked ? "Epuise pour le moment" : nachosOption.label}</small>
          </span>
          <span className="option-card__control choice-check" aria-hidden="true">
            <Check />
          </span>
        </button>

        <button
          className={`option-card nachos-choice-card choice-blue ${noSelected ? "selected" : ""}`}
          type="button"
          data-selected={noSelected}
          onClick={() => onChoose(false)}
          aria-pressed={noSelected}
        >
          <span className="option-card__shadow" aria-hidden="true" />
          <span className="option-card__accent" aria-hidden="true" />
          <span className="nachos-no-icon" aria-hidden="true">
            <X />
          </span>
          <span className="option-card__content choice-copy">
            <strong>Non merci</strong>
            <small>Juste le burger</small>
          </span>
          <span className="option-card__control choice-check" aria-hidden="true">
            <Check />
          </span>
        </button>
      </div>

      {blocked && <InlineNotice tone="warning">Les nachos sont épuisés pour le moment.</InlineNotice>}
    </section>
  );
}

function SionsContractModal({ order, onSign }) {
  return (
    <div className="modal-backdrop sions-contract-backdrop" role="presentation">
      <section
        className="sions-contract-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sions-contract-title"
      >
        <div className="sions-contract-alert" aria-hidden="true">
          <X />
          <span>Accès bloqué</span>
        </div>

        <div className="sions-contract-copy">
          <p className="eyebrow">Blacklist des Sions</p>
          <h2 id="sions-contract-title">Les Sions t&apos;ont bloqué ta commande</h2>
          <p>
            Commande #{order.number} au nom de {order.guestName}. Accepte de leur vendre tes informations pour
            débloquer ton ticket Sarah Burger.
          </p>
          <small>Contrat bidon de la team COD. Aucune vraie info n&apos;est envoyée.</small>
        </div>

        <button className="primary-action cta-button sions-contract-sign" type="button" onClick={onSign} autoFocus>
          <span className="cta-button__base" aria-hidden="true" />
          <span className="cta-button__shine" aria-hidden="true" />
          Oui, signer
        </button>
      </section>
    </div>
  );
}

function GroupOrderPrompt({ onAddBurger, onDismiss }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onDismiss}>
      <div
        className="modal-sheet modal-sheet-compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-prompt-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-sheet__header">
          <h2 id="group-prompt-title">Tu commandes pour d&apos;autres aussi ?</h2>
          <button className="modal-sheet__close" type="button" onClick={onDismiss} aria-label="Fermer">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-sheet__body">
          <p>
            Si tu commandes aussi pour tes enfants ou des proches, ajoute leur burger maintenant :
            chaque burger aura son propre numéro de ticket.
          </p>
        </div>

        <div className="modal-sheet__footer">
          <button className="secondary-action cta-button" type="button" onClick={onDismiss}>
            Non, juste moi
          </button>
          <button className="primary-action cta-button" type="button" onClick={onAddBurger}>
            <span className="cta-button__base" aria-hidden="true" />
            <span className="cta-button__shine" aria-hidden="true" />
            <UserPlus aria-hidden="true" />
            Oui, ajouter un burger
          </button>
        </div>
      </div>
    </div>
  );
}

function AddBurgerModal({ existingNames, unavailable = {}, onCancel, onConfirm }) {
  const [guestName, setGuestName] = useState("");
  const [selectedToppings, setSelectedToppings] = useState([]);
  const [selectedSauces, setSelectedSauces] = useState([]);
  const [wantsNachos, setWantsNachos] = useState(false);
  const [error, setError] = useState("");

  const trimmedName = guestName.trim();
  const isDuplicateName = useMemo(
    () =>
      trimmedName.length > 0 &&
      existingNames.some((name) => name.trim().toLowerCase() === trimmedName.toLowerCase()),
    [existingNames, trimmedName],
  );
  const namedCount = existingNames.filter(Boolean).length;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    setSelectedToppings((current) =>
      current.filter((id) => unavailable.toppings?.[id] !== true),
    );
    setSelectedSauces((current) =>
      current.filter((id) => id === noSauceOption.id || unavailable.sauces?.[id] !== true),
    );
    if (unavailable.extras?.[nachosOption.id] === true) setWantsNachos(false);
  }, [unavailable]);

  function toggleTopping(id) {
    if (unavailable.toppings?.[id] === true) return;
    setSelectedToppings((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleSauce(id) {
    if (id !== noSauceOption.id && unavailable.sauces?.[id] === true) return;
    setSelectedSauces((current) => {
      if (id === noSauceOption.id) return [noSauceOption.id];
      const withoutNone = current.filter((item) => item !== noSauceOption.id);
      return withoutNone.includes(id)
        ? withoutNone.filter((item) => item !== id)
        : [...withoutNone, id];
    });
  }

  function toggleNachos() {
    if (unavailable.extras?.[nachosOption.id] === true) return;
    setWantsNachos((current) => !current);
  }

  function handleConfirm() {
    if (!trimmedName) {
      setError("Ajoute un prénom avant de continuer.");
      return;
    }
    if (isDuplicateName) {
      setError(`Il y a déjà un burger pour « ${trimmedName} ». Ajoute une précision (ex: initiale du nom) pour les distinguer au comptoir.`);
      return;
    }
    if (selectedSauces.length === 0) {
      setError("Choisis une sauce ou Sans sauce.");
      return;
    }
    onConfirm({ guestName: trimmedName, toppings: selectedToppings, sauces: selectedSauces, nachos: wantsNachos });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-burger-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-sheet__header">
          <h2 id="add-burger-title">Ajouter un burger</h2>
          <button className="modal-sheet__close" type="button" onClick={onCancel} aria-label="Fermer">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-sheet__body">
          {namedCount > 0 && (
            <p className="cart-summary">
              Déjà dans la commande : {existingNames.filter(Boolean).join(", ")}
            </p>
          )}

          <label className="field extra-guest-field">
            <span>Prénom de cette personne</span>
            <input
              value={guestName}
              maxLength={32}
              autoComplete="off"
              placeholder="Ex. Léa"
              autoFocus
              onChange={(event) => {
                setGuestName(event.target.value);
                setError("");
              }}
            />
            {isDuplicateName && (
              <small className="field-warning">
                Il y a déjà un burger pour « {trimmedName} » dans cette commande.
              </small>
            )}
          </label>

          {error && <InlineNotice tone="error">{error}</InlineNotice>}

          <NachosOption selected={wantsNachos} onToggle={toggleNachos} unavailable={unavailable} />
          <ToppingsGrid selectedToppings={selectedToppings} onToggle={toggleTopping} unavailable={unavailable} />
          <SaucesGrid selectedSauces={selectedSauces} onToggle={toggleSauce} unavailable={unavailable} />
        </div>

        <div className="modal-sheet__footer">
          <button className="secondary-action cta-button" type="button" onClick={onCancel}>
            Annuler
          </button>
          <button className="primary-action cta-button" type="button" onClick={handleConfirm}>
            <span className="cta-button__base" aria-hidden="true" />
            <span className="cta-button__shine" aria-hidden="true" />
            <UserPlus aria-hidden="true" />
            Ajouter ce burger
          </button>
        </div>
      </div>
    </div>
  );
}

function CartList({ cart, onRemove }) {
  return (
    <ul className="cart-list">
      {cart.map((item) => (
        <li key={item.localId} className="cart-list-item">
          <span className="cart-list-name">{item.guestName || "Sans prénom"}</span>
          <span className="cart-list-detail">
            {getSauceLabels(item.sauces).join(", ") || noSauceOption.label}
            {item.nachos ? ` + ${nachosOption.label}` : ""}
          </span>
          <button
            className="cart-list-remove"
            type="button"
            onClick={() => onRemove(item.localId)}
            aria-label={`Retirer le burger de ${item.guestName || "cette personne"}`}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function OrderSummary({ guestName, toppings: toppingLabels, sauces: sauceLabels, nachos, submitState }) {
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
  const sauceCode = sauceLabels[0]?.slice(0, 2).toUpperCase() || "SS";
  const code = `${safeName}-${sauceCode}${toppingLabels.length + 1}`;

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
            <dt>Sauces</dt>
            <dd>{sauceLabels.length ? sauceLabels.join(", ") : noSauceOption.label}</dd>
          </div>
          <div>
            <dt>Extra</dt>
            <dd>{nachos ? nachosOption.label : "Sans accompagnement"}</dd>
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

function SelectedItemsRow({ toppings: toppingIds, sauces: sauceIds, nachos, compact }) {
  const items = [
    ...toppings.filter((item) => toppingIds?.includes(item.id)),
    ...sauces.filter((item) => sauceIds?.includes(item.id)),
    ...(nachos ? [nachosOption] : []),
  ];

  if (!items.length) return null;

  return (
    <div className={`selected-items-row ${compact ? "selected-items-row-compact" : ""}`}>
      {items.map((item) => (
        <div className="selected-item-chip" key={item.id}>
          <img src={assetPath(item.asset)} alt={item.label} />
          <span>{item.shortLabel || item.label}</span>
        </div>
      ))}
    </div>
  );
}

function SingleDoneScreen({ entry, orderQueue, pickupAcks, readyAlert, store }) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const isReady = entry.lastStatus === "ready";
  const messagesDisabled = entry.lastStatus === "served" || entry.lastStatus === "cancelled";
  const queueInfo = orderQueue.getInfo(entry);
  const isSarahVip = isSarahVipName(entry.guestName);
  const isUncleCod = isUncleCodName(entry.guestName);
  const isVeherOm = isVeherOmName(entry.guestName);

  return (
    <section
      className={`order-screen done-layout success-scene ${isSarahVip ? "vip-sarah-scene" : ""} ${
        isUncleCod ? "uncle-cod-scene" : ""
      } ${
        isVeherOm ? "veher-om-scene" : ""
      } ${
        isReady || readyAlert.readyAnnounced ? "ready-alert-fired" : ""
      }`}
      aria-labelledby="done-title"
      aria-live="polite"
    >
      <div className="success-copy">
        <p className="eyebrow">Ticket validé</p>
        <h1 id="done-title">{isReady ? "Ta commande est prête !" : "Commande envoyée"}</h1>
      </div>
      <div className="number-stage success-number-wrap" aria-label={`Numéro de commande ${entry.number}`}>
        <span className="success-number__burst" aria-hidden="true" />
        <img className="success-mascot success-mascot-left" src={assetPath("bigmac.svg")} alt="" aria-hidden="true" />
        <span className="order-number success-number">#{entry.number}</span>
        <img className="success-mascot success-mascot-right" src={assetPath("onions.svg")} alt="" aria-hidden="true" />
      </div>
      <p className="success-note muted">
        {isReady
          ? "Viens la récupérer au stand Sarah Burger."
          : "Ta commande entre en cuisine. Garde bien ton numéro."}
      </p>
      <OrderQueueCard info={queueInfo} />
      <FunNameNotice guestName={entry.guestName} orderNumber={entry.number} />
      <div className="success-ticket" aria-hidden="true">
        <span>SARAH BURGER</span>
        <strong>#{entry.number}</strong>
        <small>{entry.guestName}</small>
      </div>
      <SelectedItemsRow toppings={entry.toppings} sauces={entry.sauces} nachos={entry.nachos} />
      <StatusPill status={entry.lastStatus} />
      {isReady && <InlineNotice tone="success">Ta commande est prête !</InlineNotice>}
      <PickupReadyPanel entry={entry} pickupAcks={pickupAcks} />
      <ReadyAlertPanel readyAlert={readyAlert} anyReady={isReady} />
      <GuestChatButton entry={entry} onOpen={() => setIsChatOpen(true)} />
      {isChatOpen && (
        <GuestChatModal
          disabled={messagesDisabled}
          entry={entry}
          onClose={() => setIsChatOpen(false)}
          store={store}
        />
      )}
    </section>
  );
}

function GroupDoneScreen({ orderQueue, orders, pickupAcks, readyAlert, store }) {
  const [chatOrderId, setChatOrderId] = useState("");
  const anyReady = orders.some((item) => item.lastStatus === "ready");
  const queueInfos = orders.map((item) => ({ order: item, info: orderQueue.getInfo(item) }));
  const visibleQueueInfos = queueInfos.filter((item) => item.info.visible);
  const chatEntry = orders.find((item) => item.orderId === chatOrderId);

  return (
    <section
      className={`order-screen done-layout group-done-layout ${anyReady ? "ready-alert-fired" : ""}`}
      aria-labelledby="done-title"
      aria-live="polite"
    >
      <div className="success-copy">
        <p className="eyebrow">{orders.length} tickets validés</p>
        <h1 id="done-title">{anyReady ? "Une commande est prête !" : "Commandes envoyées"}</h1>
      </div>
      <ul className="group-ticket-list">
        {orders.map((item) => {
          const status = statuses[item.lastStatus] || statuses.received;
          return (
            <li key={item.orderId} className={`group-ticket-item ticket-${status.color}`}>
              <div className="group-ticket-item__main">
                <span className="group-ticket-number">#{item.number}</span>
                <span className="group-ticket-name">{item.guestName}</span>
                <StatusPill status={item.lastStatus} />
              </div>
              <FunNameNotice guestName={item.guestName} orderNumber={item.number} compact />
              {item.lastStatus === "ready" && <PickupReadyPanel entry={item} pickupAcks={pickupAcks} compact />}
              <SelectedItemsRow toppings={item.toppings} sauces={item.sauces} nachos={item.nachos} compact />
              <GuestChatButton compact entry={item} onOpen={() => setChatOrderId(item.orderId)} />
            </li>
          );
        })}
      </ul>
      <p className="success-note muted">Garde ces numéros. Viens récupérer chaque burger dès qu&apos;il est prêt.</p>
      <GroupQueueCard items={visibleQueueInfos} />
      <ReadyAlertPanel readyAlert={readyAlert} anyReady={anyReady} />
      {chatEntry && (
        <GuestChatModal
          disabled={chatEntry.lastStatus === "served" || chatEntry.lastStatus === "cancelled"}
          entry={chatEntry}
          onClose={() => setChatOrderId("")}
          store={store}
        />
      )}
    </section>
  );
}

function GuestChatButton({ compact = false, entry, onOpen }) {
  return (
    <button
      className={`primary-action guest-chat-open-button ${compact ? "compact" : ""}`}
      type="button"
      onClick={onOpen}
    >
      <MessageCircle aria-hidden="true" />
      {compact ? `Message #${entry.number}` : "Message au stand"}
    </button>
  );
}

function GuestChatModal({ disabled, entry, onClose, store }) {
  return (
    <div className="modal-backdrop guest-chat-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-sheet guest-chat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-chat-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-sheet__header">
          <div>
            <h2 id="guest-chat-title">Message au stand</h2>
            <small>Commande #{entry.number}</small>
          </div>
          <button className="modal-sheet__close" type="button" onClick={onClose} aria-label="Fermer">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="modal-sheet__body">
          <OrderMessages
            disabled={disabled}
            guestName={entry.guestName}
            orderId={entry.orderId}
            orderNumber={entry.number}
            store={store}
          />
        </div>
      </section>
    </div>
  );
}

function FunNameNotice({ guestName, orderNumber, compact = false }) {
  if (isVeherOmName(guestName)) {
    return (
      <div className={`fun-name-card veher-om-card ${compact ? "fun-name-card-compact" : ""}`}>
        <img src={assetPath("om-logo.png")} alt="" aria-hidden="true" />
        <div>
          <strong>Droit au burger activé</strong>
          <span>Veher garde son ticket mythique #{orderNumber || 13}. Virage cheddar, sauce à domicile.</span>
        </div>
      </div>
    );
  }

  if (isSarahVipName(guestName)) {
    return (
      <div className={`fun-name-card vip-sarah-card ${compact ? "fun-name-card-compact" : ""}`}>
        <Sparkles aria-hidden="true" />
        <div>
          <strong>VIP Sarah activé</strong>
          <span>Accès reine du cheddar, priorité aux paillettes.</span>
        </div>
      </div>
    );
  }

  if (isUncleCodName(guestName)) {
    return (
      <div className={`fun-name-card uncle-cod-card ${compact ? "fun-name-card-compact" : ""}`}>
        <X aria-hidden="true" />
        <div>
          <strong>Blacklist des Sions</strong>
          <span>Ticket bloqué par la team COD. Pour être débloqué, négocie tes infos au stand Sarah Burger.</span>
        </div>
      </div>
    );
  }

  return null;
}

function PickupReadyPanel({ compact = false, entry, pickupAcks }) {
  if (entry.lastStatus !== "ready") return null;

  const ack = pickupAcks.acks[entry.orderId];
  const isPending = pickupAcks.pendingId === entry.orderId;
  const isAcked = ack?.acknowledged === true;

  return (
    <section className={`pickup-buzzer ${compact ? "pickup-buzzer-compact" : ""}`} aria-live="polite">
      <span className="pickup-buzzer__beep" aria-hidden="true">BIP</span>
      <div>
        <strong>{isAcked ? "Stand prévenu" : "Bip-bip, ton burger t'attend"}</strong>
        <span>
          {isAcked
            ? "La cuisine voit que tu arrives."
            : "Appuie ici quand tu pars le récupérer."}
        </span>
      </div>
      <button
        className="primary-action compact pickup-arrive-button"
        type="button"
        disabled={isPending || isAcked}
        onClick={() => pickupAcks.acknowledge(entry)}
      >
        <CheckCircle2 aria-hidden="true" />
        {isPending ? "Envoi..." : isAcked ? "J'arrive envoyé" : "Je viens récupérer"}
      </button>
      {pickupAcks.error && <small>{pickupAcks.error}</small>}
    </section>
  );
}

function OrderQueueCard({ info }) {
  if (!info.visible) return null;

  return (
    <section className={`order-queue-card queue-${info.tone}`} aria-live="polite">
      <Clock3 aria-hidden="true" />
      <div>
        <strong>{info.title}</strong>
      </div>
    </section>
  );
}

function GroupQueueCard({ items }) {
  if (!items.length) return null;

  return (
    <section className="order-queue-card order-queue-card-group" aria-live="polite">
      <Clock3 aria-hidden="true" />
      <div>
        <strong>File en direct</strong>
        <ul>
          {items.map(({ order, info }) => (
            <li key={order.orderId}>
              <span>{order.guestName}</span>
              <b>{info.shortLabel}</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReadyAlertPanel({ readyAlert, anyReady }) {
  const isFinished =
    readyAlert.trackedOrders.length > 0 &&
    readyAlert.trackedOrders.every((item) => item.lastStatus === "served" || item.lastStatus === "cancelled");

  if (!anyReady && !readyAlert.canTestAlert) return null;

  return (
    <div className={`ready-alert-panel ${anyReady ? "ready" : ""}`} aria-live="polite">
      {anyReady ? (
        <strong>Ta commande est prête !</strong>
      ) : null}

      {readyAlert.message && <small>{readyAlert.message}</small>}
      {readyAlert.canTestAlert && !isFinished && (
        <button
          className="secondary-action compact ready-alert-test"
          type="button"
          onClick={() => readyAlert.fireReadyAlert(readyAlert.trackedOrders[0]?.orderId, { test: true })}
        >
          Tester l&apos;alerte
        </button>
      )}
    </div>
  );
}

function InlineNotice({ tone, children }) {
  return <p className={`notice notice-${tone}`}>{children}</p>;
}
