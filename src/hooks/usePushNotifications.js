import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectPushEnvironment,
  getMessagingAvailability,
  requestFcmToken,
  subscribeForegroundMessages,
} from "../services/firebaseMessaging";

function notificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

function platformLabel(environment = detectPushEnvironment()) {
  if (environment.isIos && environment.isStandalone) return "ios-standalone";
  if (environment.isIos) return "ios-safari";
  if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) return "android";
  return "web";
}

export function usePushNotifications({ onReadyMessage } = {}) {
  const [environment, setEnvironment] = useState(detectPushEnvironment);
  const [permission, setPermission] = useState(notificationPermission);
  const [supported, setSupported] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState("");
  const onReadyRef = useRef(onReadyMessage);

  useEffect(() => {
    onReadyRef.current = onReadyMessage;
  }, [onReadyMessage]);

  useEffect(() => {
    let cancelled = false;
    setEnvironment(detectPushEnvironment());
    setPermission(notificationPermission());

    getMessagingAvailability()
      .then((availability) => {
        if (cancelled) return;
        setEnvironment(availability);
        setSupported(Boolean(availability.supported));
        if (availability.reason) setMessage(availability.reason);
      })
      .catch((error) => {
        if (cancelled) return;
        setSupported(false);
        setMessage(error.message || "Notifications push indisponibles.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;

    subscribeForegroundMessages((messagePayload) => {
      onReadyRef.current?.(messagePayload);
    })
      .then((nextUnsubscribe) => {
        if (cancelled) {
          nextUnsubscribe?.();
          return;
        }
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        setMessage(error.message || "Ecoute push indisponible.");
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const enableForOrder = useCallback(async ({ order, saveSubscription }) => {
    if (!order?.id) throw new Error("Commande introuvable pour l'alerte push.");
    if (typeof saveSubscription !== "function") {
      throw new Error("Stockage push indisponible sur ce mode.");
    }

    const availability = await getMessagingAvailability();
    setEnvironment(availability);
    setSupported(Boolean(availability.supported));

    if (!availability.supported) {
      setMessage(availability.reason || "Garde cette page ouverte pour être averti.");
      return { enabled: false, reason: availability.reason };
    }

    setIsRegistering(true);
    setMessage("On va te demander l'autorisation pour prévenir quand le burger est prêt.");

    try {
      const tokenResult = await requestFcmToken();
      const subscription = await saveSubscription(order, tokenResult.token, {
        platform: platformLabel(availability),
      });

      setPermission(tokenResult.permission);
      setMessage("Alerte push activée. Tu peux quitter la page, le téléphone préviendra si le système l'autorise.");
      return {
        enabled: true,
        permission: tokenResult.permission,
        subscriptionId: subscription.subscriptionId,
      };
    } finally {
      setIsRegistering(false);
    }
  }, []);

  return {
    canRequest: Boolean(environment.canRequest && supported),
    enableForOrder,
    environment,
    isIosDevice: environment.isIos,
    isRegistering,
    isStandalone: environment.isStandalone,
    message,
    notificationSupported: environment.notificationSupported,
    permission,
    platform: platformLabel(environment),
    supported,
  };
}
