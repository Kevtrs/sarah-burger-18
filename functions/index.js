const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onValueUpdated } = require("firebase-functions/v2/database");

admin.initializeApp();

const EVENT_SESSION_ID = "sarah-18-2026";
const READY_FROM_STATUSES = new Set(["received", "preparing"]);
const FUNCTION_REGION = process.env.FUNCTION_REGION || "europe-west1";
const PUBLIC_SITE_URL =
  process.env.SARAH_BURGER_PUBLIC_SITE_URL || "https://kevtrs.github.io/sarah-burger-18/";
const READY_TITLE = "Ton burger est prêt 🍔";
const SERVER_TIMESTAMP = admin.database.ServerValue.TIMESTAMP;

function siteUrl() {
  return PUBLIC_SITE_URL.endsWith("/") ? PUBLIC_SITE_URL : `${PUBLIC_SITE_URL}/`;
}

function orderReadyBody(orderNumber) {
  return `Commande #${orderNumber} — viens la récupérer au stand Sarah Burger.`;
}

function redactedToken(token) {
  if (typeof token !== "string" || token.length < 12) return "token-redacted";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function isInvalidTokenError(error) {
  return [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ].includes(error?.code);
}

async function claimReadyNotification(sessionId, orderId) {
  const claimId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const claimRef = admin.database().ref(`sessions/${sessionId}/readyNotifications/${orderId}`);
  const result = await claimRef.transaction(
    (current) => {
      if (current?.sent === true) return current;
      if (current?.sending === true && startedAtMs - Number(current.startedAtMs || 0) < 120000) {
        return current;
      }

      return {
        claimId,
        orderId,
        sending: true,
        sent: false,
        startedAtMs,
        updatedAtMs: startedAtMs,
      };
    },
    undefined,
    false,
  );

  const value = result.snapshot.val();
  return {
    claimId,
    claimRef,
    claimed: result.committed && value?.claimId === claimId && value?.sent !== true,
  };
}

async function sendSubscriptionNotification({ order, orderId, sessionId, subscriptionSnapshot }) {
  const subscription = subscriptionSnapshot.val() || {};
  if (subscription.enabled !== true || subscription.notificationSent === true) {
    return { skipped: true };
  }

  const token = subscription.token;
  if (typeof token !== "string" || token.length < 20) {
    await subscriptionSnapshot.ref.remove();
    return { invalid: true };
  }

  const orderNumber = Number(order.number || subscription.orderNumber || 0);
  const url = siteUrl();
  const iconUrl = new URL("assets/sarah-logo.svg", url).href;
  const body = orderReadyBody(orderNumber);

  try {
    await admin.messaging().send({
      token,
      data: {
        type: "order-ready",
        orderId,
        orderNumber: String(orderNumber),
        title: READY_TITLE,
        body,
        icon: iconUrl,
        badge: iconUrl,
        tag: `sarah-burger-ready-${orderId}`,
        url,
      },
      webpush: {
        fcmOptions: {
          link: url,
        },
        headers: {
          TTL: "3600",
        },
      },
    });

    await subscriptionSnapshot.ref.update({
      lastError: null,
      lastSentAtMs: SERVER_TIMESTAMP,
      notificationSent: true,
      notifiedAtMs: SERVER_TIMESTAMP,
    });

    return { sent: true };
  } catch (error) {
    logger.warn("FCM send failed", {
      code: error?.code || "unknown",
      orderId,
      sessionId,
      token: redactedToken(token),
    });

    if (isInvalidTokenError(error)) {
      await subscriptionSnapshot.ref.remove();
      return { invalid: true };
    }

    await subscriptionSnapshot.ref.update({
      lastError: error?.code || "messaging/send-failed",
    });
    return { failed: true };
  }
}

async function disableOrderSubscriptions(sessionId, orderId) {
  const snapshot = await admin
    .database()
    .ref(`sessions/${sessionId}/pushSubscriptions/${orderId}`)
    .get();

  if (!snapshot.exists()) return;

  const updates = {};
  snapshot.forEach((subscriptionSnapshot) => {
    updates[`${subscriptionSnapshot.key}/enabled`] = false;
    updates[`${subscriptionSnapshot.key}/disabledAtMs`] = SERVER_TIMESTAMP;
  });

  if (Object.keys(updates).length > 0) {
    await snapshot.ref.update(updates);
  }
}

exports.sendReadyNotification = onValueUpdated(
  {
    ref: "/sessions/{sessionId}/orders/{orderId}/status",
    region: FUNCTION_REGION,
  },
  async (event) => {
    const { orderId, sessionId } = event.params;
    const beforeStatus = event.data.before.val();
    const afterStatus = event.data.after.val();

    if (sessionId !== EVENT_SESSION_ID) return;

    if (afterStatus === "served" || afterStatus === "cancelled") {
      await disableOrderSubscriptions(sessionId, orderId);
      return;
    }

    if (!READY_FROM_STATUSES.has(beforeStatus) || afterStatus !== "ready") {
      return;
    }

    const { claimRef, claimed } = await claimReadyNotification(sessionId, orderId);
    if (!claimed) {
      logger.info("Ready push already claimed", { orderId, sessionId });
      return;
    }

    try {
      const orderSnapshot = await admin
        .database()
        .ref(`sessions/${sessionId}/orders/${orderId}`)
        .get();
      const order = orderSnapshot.val();

      if (!order) {
        await claimRef.update({
          lastError: "order-not-found",
          sending: false,
          updatedAtMs: SERVER_TIMESTAMP,
        });
        return;
      }

      const subscriptionsSnapshot = await admin
        .database()
        .ref(`sessions/${sessionId}/pushSubscriptions/${orderId}`)
        .get();

      let sent = 0;
      let failed = 0;
      let invalid = 0;
      let skipped = 0;

      const tasks = [];
      subscriptionsSnapshot.forEach((subscriptionSnapshot) => {
        tasks.push(
          sendSubscriptionNotification({
            order,
            orderId,
            sessionId,
            subscriptionSnapshot,
          }),
        );
      });

      const results = await Promise.all(tasks);
      results.forEach((result) => {
        if (result.sent) sent += 1;
        else if (result.invalid) invalid += 1;
        else if (result.failed) failed += 1;
        else skipped += 1;
      });

      await claimRef.update({
        delivered: sent,
        failed,
        invalid,
        sending: false,
        sent: true,
        skipped,
        updatedAtMs: SERVER_TIMESTAMP,
      });

      logger.info("Ready push processed", {
        delivered: sent,
        failed,
        invalid,
        orderId,
        sessionId,
        skipped,
      });
    } catch (error) {
      await claimRef.update({
        lastError: error?.code || error?.message || "ready-push-failed",
        sending: false,
        sent: false,
        updatedAtMs: SERVER_TIMESTAMP,
      });
      logger.error("Ready push failed", {
        code: error?.code || "unknown",
        orderId,
        sessionId,
      });
      throw error;
    }
  },
);
