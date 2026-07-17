import { Bell, BellRing } from "lucide-react";

export function PushNotificationPrompt({ order, readyAlert }) {
  const isReady = order.status === "ready";
  const isFinished = order.status === "served" || order.status === "cancelled";
  const watchEnabled = readyAlert.trackedOrder?.watchEnabled === true;
  const notificationsEnabled = readyAlert.trackedOrder?.notificationsEnabled === true;
  const isIosSafariTab = readyAlert.isIosDevice && !readyAlert.isIosStandalone;
  const showFallbackMessage =
    watchEnabled &&
    (!readyAlert.notificationSupported || readyAlert.permission === "denied" || !notificationsEnabled);
  const showIosGuide = isIosSafariTab && !isFinished;

  return (
    <div className={`ready-alert-panel ${isReady ? "ready" : ""}`} aria-live="polite">
      {isReady ? (
        <strong>Ta commande est prête !</strong>
      ) : (
        <p>On peut te prévenir dès que le stand passe ta commande en prête.</p>
      )}

      {!isReady && !isFinished && !watchEnabled && (
        <button
          className="secondary-action compact ready-alert-button"
          type="button"
          onClick={readyAlert.enableAlerts}
          disabled={readyAlert.pushIsRegistering}
        >
          <Bell aria-hidden="true" />
          {readyAlert.pushIsRegistering ? "Activation..." : "M'avertir quand c'est prêt"}
        </button>
      )}

      {!isReady && !isFinished && watchEnabled && (
        <span className="ready-alert-state">
          <BellRing aria-hidden="true" />
          {notificationsEnabled ? "Alerte push activée" : "Alerte dans cette page"}
        </span>
      )}

      {readyAlert.message && <small>{readyAlert.message}</small>}
      {!readyAlert.message && readyAlert.pushMessage && <small>{readyAlert.pushMessage}</small>}
      {showFallbackMessage && <small>Garde cette page ouverte pour être averti.</small>}

      {showIosGuide && (
        <div className="ready-alert-ios">
          <small>
            Sur iPhone, ajoute Sarah Burger à ton écran d’accueil pour recevoir l’alerte après avoir quitté Safari.
          </small>
          <ol>
            <li>Ouvre le menu Partager.</li>
            <li>Choisis Sur l’écran d’accueil.</li>
            <li>Ouvre Sarah Burger installée.</li>
            <li>Appuie sur M’avertir quand c’est prêt.</li>
          </ol>
        </div>
      )}

      {readyAlert.canTestNotification && !isFinished && (
        <button
          className="secondary-action compact ready-alert-test"
          type="button"
          onClick={() => readyAlert.fireReadyAlert({ test: true })}
        >
          Tester la notification
        </button>
      )}
    </div>
  );
}
