import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const appUrl = process.env.APP_URL || "http://127.0.0.1:5178";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const executablePath = fs.existsSync(chromePath) ? chromePath : edgePath;

if (!fs.existsSync(executablePath)) {
  throw new Error("Chrome ou Edge introuvable pour la validation headless.");
}

async function checkOverflow(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    title: document.querySelector("h1")?.innerText || "",
    overflowing:
      document.documentElement.scrollWidth > window.innerWidth ||
      document.body.scrollWidth > window.innerWidth,
  }));
}

async function openKitchen(page) {
  await page.goto(`${appUrl}/#stand`);

  const gate = page.locator(".pin-box");
  if ((await gate.count()) > 0) {
    const email = page.locator('input[type="email"]');
    const password = page.locator('input[type="password"]');

    if ((await email.count()) > 0) {
      await email.fill(process.env.KITCHEN_TEST_EMAIL || "cuisine@example.com");
    }

    if ((await password.count()) > 0) {
      await password.fill(process.env.KITCHEN_TEST_PASSWORD || "test-password");
    }

    await page.locator(".pin-box .primary-action").click();
  }
}

async function waitForTicketStatus(page, text) {
  await page.locator(".ticket .status-pill", { hasText: text }).waitFor();
}

async function assertMascotVisible(page, card, label) {
  await page.waitForTimeout(650);

  const metrics = await card.locator(".option-card__art img").evaluate((img) => {
    const style = window.getComputedStyle(img);
    const rect = img.getBoundingClientRect();

    return {
      animationName: style.animationName,
      display: style.display,
      height: rect.height,
      opacity: Number(style.opacity),
      visibility: style.visibility,
      width: rect.width,
    };
  });

  if (
    metrics.display === "none" ||
    metrics.visibility === "hidden" ||
    metrics.opacity < 0.95 ||
    metrics.width < 8 ||
    metrics.height < 8
  ) {
    throw new Error(`${label} mascot is not visible: ${JSON.stringify(metrics)}`);
  }

  return metrics;
}

async function exerciseMascotSelection(page) {
  const toppingCards = page.locator("button.choice-card");
  const sauceCards = page.locator("button.sauce-card");
  const onionsCard = toppingCards.nth(2);
  const spicyCard = sauceCards.nth(4);

  await onionsCard.click();
  const onionsSelected = await assertMascotVisible(page, onionsCard, "Oignons frits selected");
  await onionsCard.click();
  const onionsUnselected = await assertMascotVisible(page, onionsCard, "Oignons frits unselected");
  await onionsCard.click();
  const onionsSelectedAgain = await assertMascotVisible(page, onionsCard, "Oignons frits selected again");
  await onionsCard.click();

  await spicyCard.click();
  const spicySelected = await assertMascotVisible(page, spicyCard, "Sauce piquante selected");
  await sauceCards.nth(0).click();
  const spicyUnselected = await assertMascotVisible(page, spicyCard, "Sauce piquante unselected");
  await spicyCard.click();
  const spicySelectedAgain = await assertMascotVisible(page, spicyCard, "Sauce piquante selected again");

  return {
    onionsSelected,
    onionsUnselected,
    onionsSelectedAgain,
    spicySelected,
    spicyUnselected,
    spicySelectedAgain,
  };
}

async function submitOrderFromPage(page, guestName, toppingIndex, sauceIndex) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("sarah-burger-ready-alert-v1");
  });
  await page.goto(`${appUrl}/#commande`);
  const nameInput = page.locator('input[placeholder="Ex. Sarah"]');
  await page.locator('input[placeholder="Ex. Sarah"], .success-scene').first().waitFor();
  if ((await nameInput.count()) === 0) {
    const resetButton = page.getByRole("button", { name: "Nouvelle commande" });
    if ((await resetButton.count()) > 0) {
      await resetButton.click();
    }
  }
  await nameInput.fill(guestName);
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.locator("button.choice-card").first().waitFor();
  await page.locator("button.choice-card").nth(toppingIndex).click();
  await page.locator("button.sauce-card").nth(sauceIndex).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Envoyer" }).click();
  await page.locator(".order-number").waitFor();
}

function recordErrors(page, errors) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
}

async function run() {
  const browser = await chromium.launch({ executablePath, headless: true });
  const consoleErrors = [];
  const screenshotDir = path.join(os.tmpdir(), "sarah-burger-validation");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await mobileContext.addInitScript(() => {
    window.__newOrderDingStarts = 0;

    class TestAudioNode {
      connect() {}
    }

    class TestGain extends TestAudioNode {
      constructor() {
        super();
        this.gain = {
          exponentialRampToValueAtTime() {},
          setValueAtTime() {},
        };
      }
    }

    class TestOscillator extends TestAudioNode {
      constructor() {
        super();
        this.frequency = {
          exponentialRampToValueAtTime() {},
          setValueAtTime() {},
        };
        this.type = "sine";
      }

      start() {
        window.__newOrderDingStarts += 1;
      }

      stop() {}
    }

    class TestAudioContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.state = "running";
      }

      createGain() {
        return new TestGain();
      }

      createOscillator() {
        return new TestOscillator();
      }

      resume() {
        return Promise.resolve();
      }
    }

    window.AudioContext = TestAudioContext;
    window.webkitAudioContext = TestAudioContext;
    window.__notificationRequests = 0;
    window.__readyAlertSoundPlays = 0;
    window.__readyNotifications = [];
    window.__readyVibrations = [];
    window.__nextNotificationPermission = "granted";

    class TestNotification {
      static permission = "default";

      static requestPermission() {
        window.__notificationRequests += 1;
        TestNotification.permission = window.__nextNotificationPermission;
        return Promise.resolve(TestNotification.permission);
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        window.__readyNotifications.push({ title, body: options.body, tag: options.tag });
      }
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: TestNotification,
    });

    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value(pattern) {
        window.__readyVibrations.push(pattern);
        return true;
      },
    });

    window.HTMLMediaElement.prototype.play = function play() {
      if (!this.muted) window.__readyAlertSoundPlays += 1;
      return Promise.resolve();
    };

    window.HTMLMediaElement.prototype.pause = function pause() {};
  });
  const page = await mobileContext.newPage();
  recordErrors(page, consoleErrors);

  await page.goto(`${appUrl}/#commande`);
  await page.locator('input[placeholder="Ex. Sarah"]').fill("Nina");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.locator("button.choice-card").first().waitFor();

  const toppingCards = page.locator("button.choice-card");
  if ((await toppingCards.count()) !== 3) throw new Error("Expected 3 topping cards.");
  const mascotMetrics = await exerciseMascotSelection(page);
  await toppingCards.nth(1).click();

  const sauceCards = page.locator("button.sauce-card");
  if ((await sauceCards.count()) !== 5) throw new Error("Expected 5 sauce cards.");
  await sauceCards.nth(1).click();

  await page.getByRole("button", { name: "Continuer" }).click();
  const reviewText = await page.locator(".summary-list").innerText();
  await page.getByRole("button", { name: "Envoyer" }).click();
  await page.locator(".order-number").waitFor();

  const guestConfirmation = {
    number: await page.locator(".order-number").innerText(),
    status: await page.locator(".status-pill").innerText(),
  };

  await page.locator(".ready-alert-button").click();
  await page.locator(".ready-alert-state", { hasText: "Alerte dans cette page" }).waitFor();

  const readyPermission = await page.evaluate(() => ({
    notificationRequests: window.__notificationRequests,
    readyAlertSoundPlays: window.__readyAlertSoundPlays,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v1")),
  }));
  if (readyPermission.notificationRequests !== 0) {
    throw new Error("Ready notification permission was requested without push config.");
  }
  if (readyPermission.readyAlertSoundPlays !== 0) {
    throw new Error("Ready alert sound played while only unlocking audio.");
  }
  if (
    !readyPermission.stored?.orderId ||
    readyPermission.stored.notificationsEnabled !== false ||
    readyPermission.stored.watchEnabled !== true
  ) {
    throw new Error("Ready alert fallback preference/order was not stored.");
  }

  const kitchenPage = await mobileContext.newPage();
  recordErrors(kitchenPage, consoleErrors);
  await openKitchen(kitchenPage);
  await kitchenPage.locator(".ticket").waitFor();
  await kitchenPage.waitForTimeout(800);

  const initialSoundStarts = await kitchenPage.evaluate(() => window.__newOrderDingStarts || 0);
  if (initialSoundStarts !== 0) {
    throw new Error("Kitchen sound played during the first orders snapshot.");
  }

  const remoteOrderPage = await mobileContext.newPage();
  recordErrors(remoteOrderPage, consoleErrors);
  await submitOrderFromPage(remoteOrderPage, "Mila", 0, 0);
  await remoteOrderPage.close();

  await kitchenPage.locator(".ticket", { hasText: "Mila" }).waitFor();
  await kitchenPage.waitForTimeout(900);

  const soundAfterNewOrder = await kitchenPage.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterNewOrder !== 2) {
    throw new Error(`Expected one new-order ding, got ${soundAfterNewOrder} oscillator starts.`);
  }

  const ninaTicket = kitchenPage.locator(".ticket", { hasText: "Nina" });
  const kitchenBefore = await ninaTicket.innerText();
  await ninaTicket.locator("footer .primary-action").click();
  await ninaTicket.locator(".status-pill", { hasText: "En préparation" }).waitFor();
  await page.waitForTimeout(900);

  const readyBeforeReady = await page.evaluate(() => ({
    notificationCount: window.__readyNotifications.length,
    soundPlays: window.__readyAlertSoundPlays,
    title: document.querySelector("#done-title")?.innerText,
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
    readyBeforeReady.notificationCount !== 0 ||
    readyBeforeReady.soundPlays !== 0 ||
    readyBeforeReady.vibrationCount !== 0 ||
    readyBeforeReady.title !== "Commande envoyée"
  ) {
    throw new Error(`Ready alert fired before ready status: ${JSON.stringify(readyBeforeReady)}`);
  }

  const soundAfterStatusChange = await kitchenPage.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterStatusChange !== soundAfterNewOrder) {
    throw new Error("Kitchen sound replayed after a status change.");
  }

  await ninaTicket.locator("footer .primary-action").click();
  await ninaTicket.locator(".status-pill", { hasText: "Prête" }).waitFor();
  await page.locator("#done-title", { hasText: "Ta commande est prête !" }).waitFor();

  const readyAfterReady = await page.evaluate(() => ({
    notification: window.__readyNotifications[0],
    notificationCount: window.__readyNotifications.length,
    soundPlays: window.__readyAlertSoundPlays,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v1")),
    title: document.querySelector("#done-title")?.innerText,
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
    readyAfterReady.notificationCount !== 0 ||
    readyAfterReady.soundPlays !== 1 ||
    readyAfterReady.vibrationCount !== 1 ||
    readyAfterReady.stored?.readyNotified !== true ||
    readyAfterReady.title !== "Ta commande est prête !"
  ) {
    throw new Error(`Ready alert did not fire correctly: ${JSON.stringify(readyAfterReady)}`);
  }

  await page.reload();
  await page.locator("#done-title", { hasText: "Ta commande est prête !" }).waitFor();
  await page.waitForTimeout(900);
  const readyAfterClientReload = await page.evaluate(() => ({
    notificationCount: window.__readyNotifications.length,
    soundPlays: window.__readyAlertSoundPlays,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v1")),
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
    readyAfterClientReload.notificationCount !== 0 ||
    readyAfterClientReload.soundPlays !== 0 ||
    readyAfterClientReload.vibrationCount !== 0 ||
    readyAfterClientReload.stored?.readyNotified !== true
  ) {
    throw new Error(`Ready alert replayed after reload: ${JSON.stringify(readyAfterClientReload)}`);
  }

  const soundToggle = kitchenPage.locator('button[aria-pressed]');
  if ((await soundToggle.count()) !== 1) throw new Error("Kitchen sound toggle not found.");
  await soundToggle.click();
  const storedSoundOff = await kitchenPage.evaluate(() =>
    window.localStorage.getItem("sarah-burger-kitchen-sound-enabled"),
  );
  if (storedSoundOff !== "off") throw new Error("Kitchen sound preference was not stored as off.");

  const mutedOrderPage = await mobileContext.newPage();
  recordErrors(mutedOrderPage, consoleErrors);
  await submitOrderFromPage(mutedOrderPage, "Lou", 2, 4);
  await mutedOrderPage.close();

  await kitchenPage.locator(".ticket", { hasText: "Lou" }).waitFor();
  await kitchenPage.waitForTimeout(900);

  const soundAfterMutedOrder = await kitchenPage.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterMutedOrder !== soundAfterNewOrder) {
    throw new Error("Kitchen sound played while muted.");
  }

  const deniedPage = await mobileContext.newPage();
  recordErrors(deniedPage, consoleErrors);
  await submitOrderFromPage(deniedPage, "Noe", 0, 2);
  await deniedPage.evaluate(() => {
    window.Notification.permission = "default";
    window.__nextNotificationPermission = "denied";
  });
  await deniedPage.locator(".ready-alert-button").click();
  await deniedPage.locator(".ready-alert-panel", { hasText: "Garde cette page ouverte" }).waitFor();

  const deniedPermission = await deniedPage.evaluate(() => ({
    notificationRequests: window.__notificationRequests,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v1")),
  }));
  if (
    deniedPermission.notificationRequests !== 0 ||
    deniedPermission.stored?.notificationsEnabled !== false ||
    deniedPermission.stored?.watchEnabled !== true
  ) {
    throw new Error(`Denied notification preference was not stored: ${JSON.stringify(deniedPermission)}`);
  }

  const deniedTicket = kitchenPage.locator(".ticket", { hasText: "Noe" });
  await deniedTicket.waitFor();
  await deniedTicket.locator("footer .primary-action").click();
  await deniedTicket.locator(".status-pill", { hasText: "En préparation" }).waitFor();
  await deniedTicket.locator("footer .primary-action").click();
  await deniedTicket.locator(".status-pill", { hasText: "Prête" }).waitFor();
  await deniedPage.locator("#done-title", { hasText: "Ta commande est prête !" }).waitFor();

  const deniedReadyAlert = await deniedPage.evaluate(() => ({
    notificationCount: window.__readyNotifications.length,
    soundPlays: window.__readyAlertSoundPlays,
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
    deniedReadyAlert.notificationCount !== 0 ||
    deniedReadyAlert.soundPlays !== 1 ||
    deniedReadyAlert.vibrationCount !== 1
  ) {
    throw new Error(`Denied ready fallback failed: ${JSON.stringify(deniedReadyAlert)}`);
  }
  await deniedPage.close();

  await soundToggle.click();
  const storedSoundOn = await kitchenPage.evaluate(() =>
    window.localStorage.getItem("sarah-burger-kitchen-sound-enabled"),
  );
  if (storedSoundOn !== "on") throw new Error("Kitchen sound preference was not stored as on.");

  await kitchenPage.reload();
  await openKitchen(kitchenPage);
  await kitchenPage.locator('button[aria-pressed="true"]', { hasText: "Son" }).waitFor();
  await kitchenPage.waitForTimeout(800);
  const soundAfterReload = await kitchenPage.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterReload !== 0) {
    throw new Error("Kitchen sound played after reloading existing orders.");
  }

  const ninaTicketAfterReload = kitchenPage.locator(".ticket", { hasText: "Nina" });
  await ninaTicketAfterReload.locator("footer .primary-action").click();
  await kitchenPage.getByRole("tab", { name: "Servies" }).click();
  await waitForTicketStatus(kitchenPage, "Servie");
  const kitchenAfter = await kitchenPage.locator(".ticket", { hasText: "Nina" }).innerText();

  if (!kitchenAfter.includes("Servie")) {
    throw new Error("Kitchen status did not advance to served.");
  }

  const mobileMetrics = await checkOverflow(kitchenPage);
  if (mobileMetrics.overflowing) throw new Error("Mobile layout overflows horizontally.");

  const mobileShot = path.join(screenshotDir, "mobile-kitchen.png");
  await kitchenPage.screenshot({ path: mobileShot, fullPage: true });
  await mobileContext.close();

  const viewportMetrics = [];
  const viewports = [
    { width: 360, height: 780, name: "mobile-360" },
    { width: 390, height: 844, name: "mobile-390" },
    { width: 430, height: 932, name: "mobile-430" },
    { width: 768, height: 1024, name: "tablet-768" },
    { width: 1280, height: 900, name: "desktop-1280" },
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.width < 768,
      deviceScaleFactor: viewport.width < 768 ? 2 : 1,
    });
    const viewportPage = await context.newPage();
    recordErrors(viewportPage, consoleErrors);
    await viewportPage.goto(`${appUrl}/#commande`);
    const orderMetrics = await checkOverflow(viewportPage);
    if (orderMetrics.overflowing) {
      throw new Error(`Order layout overflows horizontally at ${viewport.name}.`);
    }
    await viewportPage.locator('input[placeholder="Ex. Sarah"]').fill("Vue");
    await viewportPage.getByRole("button", { name: "Continuer" }).click();
    await viewportPage.locator("button.choice-card").nth(2).click();
    const viewportOnions = await assertMascotVisible(
      viewportPage,
      viewportPage.locator("button.choice-card").nth(2),
      `Oignons frits ${viewport.name}`,
    );
    await viewportPage.locator("button.sauce-card").nth(4).click();
    const viewportSpicy = await assertMascotVisible(
      viewportPage,
      viewportPage.locator("button.sauce-card").nth(4),
      `Sauce piquante ${viewport.name}`,
    );
    await openKitchen(viewportPage);
    const kitchenMetrics = await checkOverflow(viewportPage);
    if (kitchenMetrics.overflowing) {
      throw new Error(`Kitchen layout overflows horizontally at ${viewport.name}.`);
    }
    viewportMetrics.push({
      name: viewport.name,
      orderMetrics,
      kitchenMetrics,
      mascotMetrics: { onions: viewportOnions, spicy: viewportSpicy },
    });
    await context.close();
  }

  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desktop = await desktopContext.newPage();
  recordErrors(desktop, consoleErrors);

  await desktop.goto(`${appUrl}/#commande`);
  const desktopMetrics = await checkOverflow(desktop);
  if (desktopMetrics.overflowing) throw new Error("Desktop layout overflows horizontally.");

  const desktopShot = path.join(screenshotDir, "desktop-order.png");
  await desktop.screenshot({ path: desktopShot, fullPage: true });
  await desktopContext.close();
  await browser.close();

  if (consoleErrors.length) {
    throw new Error(`Console errors found:\n${consoleErrors.join("\n")}`);
  }

  console.log(
    JSON.stringify(
      {
        reviewText,
        guestConfirmation,
        kitchenBefore,
        kitchenAfter,
        mascotMetrics,
        kitchenSound: {
          initialSoundStarts,
          soundAfterNewOrder,
          soundAfterStatusChange,
          soundAfterMutedOrder,
          soundAfterReload,
          storedSoundOff,
          storedSoundOn,
        },
        readyAlert: {
          deniedPermission,
          deniedReadyAlert,
          readyAfterClientReload,
          readyAfterReady,
          readyBeforeReady,
          readyPermission,
        },
        mobileMetrics,
        desktopMetrics,
        viewportMetrics,
        screenshots: { mobileShot, desktopShot },
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
