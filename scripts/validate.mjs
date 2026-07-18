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

async function checkStickyActions(page, label) {
  const metrics = await page.evaluate(() => {
    const bar = document.querySelector(".sticky-actions");
    const buttons = Array.from(bar?.querySelectorAll("button") || []);
    const barRect = bar?.getBoundingClientRect();
    const buttonRects = buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        text: button.innerText,
        top: rect.top,
        width: rect.width,
      };
    });

    return {
      buttonRects,
      exists: Boolean(bar),
      barBottom: barRect?.bottom || 0,
      barHeight: barRect?.height || 0,
      barTop: barRect?.top || 0,
      viewportHeight: window.innerHeight,
    };
  });

  if (!metrics.exists || metrics.buttonRects.length === 0) {
    throw new Error(`Sticky actions missing at ${label}: ${JSON.stringify(metrics)}`);
  }

  const hiddenButton = metrics.buttonRects.find(
    (rect) =>
      rect.height < 36 ||
      rect.width < 42 ||
      rect.bottom > metrics.viewportHeight + 1 ||
      rect.top < -1,
  );

  if (hiddenButton || metrics.barBottom > metrics.viewportHeight + 1) {
    throw new Error(`Sticky actions are not reachable at ${label}: ${JSON.stringify(metrics)}`);
  }

  return metrics;
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

async function dismissGroupPromptIfVisible(page) {
  const dismissButton = page.getByRole("button", { name: "Non, juste moi" });
  try {
    await dismissButton.waitFor({ timeout: 900 });
    await dismissButton.click();
  } catch {
    // The prompt is intentionally delayed and does not always appear before submit.
  }
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
  const toppingCards = page.locator(".toppings-grid button.choice-card");
  const sauceCards = page.locator("button.sauce-card");
  const onionsCard = toppingCards.nth(2);
  const spicyCard = sauceCards.nth(5);
  const mustardCard = sauceCards.nth(6);

  await onionsCard.click();
  const onionsSelected = await assertMascotVisible(page, onionsCard, "Oignons frits selected");
  await onionsCard.click();
  const onionsUnselected = await assertMascotVisible(page, onionsCard, "Oignons frits unselected");
  await onionsCard.click();
  const onionsSelectedAgain = await assertMascotVisible(page, onionsCard, "Oignons frits selected again");
  await onionsCard.click();

  await spicyCard.click();
  const spicySelected = await assertMascotVisible(page, spicyCard, "Sauce piquante selected");
  await sauceCards.nth(1).click();
  const spicyStillSelected = await assertMascotVisible(page, spicyCard, "Sauce piquante co-selected");
  await spicyCard.click();
  const spicyUnselected = await assertMascotVisible(page, spicyCard, "Sauce piquante unselected");
  await mustardCard.click();
  const mustardSelected = await assertMascotVisible(page, mustardCard, "Moutarde selected");
  await mustardCard.click();
  const mustardUnselected = await assertMascotVisible(page, mustardCard, "Moutarde unselected");

  return {
    onionsSelected,
    onionsUnselected,
    onionsSelectedAgain,
    spicySelected,
    spicyStillSelected,
    spicyUnselected,
    mustardSelected,
    mustardUnselected,
  };
}

async function submitOrderFromPage(page, guestName, toppingIndex, sauceIndex) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("sarah-burger-ready-alert-v2");
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
  await page.locator(".toppings-grid button.choice-card").first().waitFor();
  await page.locator(".toppings-grid button.choice-card").nth(toppingIndex).click();
  await page.locator("button.sauce-card").nth(sauceIndex).click();
  await page.getByRole("button", { name: "Choisir les nachos" }).click();
  await page.locator(".nachos-decision-grid").waitFor();
  await page.getByRole("button", { name: /Non merci/ }).click();
  await page.getByRole("button", { name: "Voir le ticket" }).click();
  await dismissGroupPromptIfVisible(page);
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
    window.__readyAlertSoundPlays = 0;
    window.__readyVibrations = [];

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
  await page.locator(".toppings-grid button.choice-card").first().waitFor();

  const toppingCards = page.locator(".toppings-grid button.choice-card");
  if ((await toppingCards.count()) !== 4) throw new Error("Expected 4 topping cards.");
  const mascotMetrics = await exerciseMascotSelection(page);
  await toppingCards.nth(1).click();

  const sauceCards = page.locator("button.sauce-card");
  if ((await sauceCards.count()) !== 7) throw new Error("Expected 7 sauce cards.");
  await sauceCards.nth(2).click();
  await sauceCards.nth(6).click();

  await page.getByRole("button", { name: "Choisir les nachos" }).click();
  await page.locator(".nachos-decision-grid").waitFor();
  await page.getByRole("button", { name: /Oui, barquette/ }).click();
  await page.getByRole("button", { name: "Voir le ticket" }).click();
  await dismissGroupPromptIfVisible(page);
  const reviewText = await page.locator(".summary-list").innerText();
  if (!reviewText.includes("Giant") || !reviewText.includes("Moutarde") || !reviewText.includes("Nachos")) {
    throw new Error(`Multiple sauces are missing from the review: ${reviewText}`);
  }
  await page.getByRole("button", { name: "Envoyer" }).click();
  await page.locator(".order-number").waitFor();

  const guestConfirmation = {
    number: await page.locator(".order-number").innerText(),
    status: await page.locator(".status-pill").innerText(),
  };

  const readyPermission = await page.evaluate(() => ({
    readyAlertSoundPlays: window.__readyAlertSoundPlays,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v2")),
  }));
  if (readyPermission.readyAlertSoundPlays !== 0) {
    throw new Error("Ready alert sound played while only unlocking audio.");
  }
  if (
    !readyPermission.stored?.orders?.[0]?.orderId ||
    readyPermission.stored.audioUnlocked !== true
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
  const noSauceTicketText = await kitchenPage.locator(".ticket", { hasText: "Mila" }).innerText();
  if (!noSauceTicketText.includes("Sans sauce")) {
    throw new Error(`No-sauce order is missing in kitchen ticket: ${noSauceTicketText}`);
  }
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
    soundPlays: window.__readyAlertSoundPlays,
    title: document.querySelector("#done-title")?.innerText,
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
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
    soundPlays: window.__readyAlertSoundPlays,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v2")),
    title: document.querySelector("#done-title")?.innerText,
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
    readyAfterReady.soundPlays !== 1 ||
    readyAfterReady.vibrationCount !== 1 ||
    !readyAfterReady.stored?.orders?.some((order) => order.readyNotified === true) ||
    readyAfterReady.title !== "Ta commande est prête !"
  ) {
    throw new Error(`Ready alert did not fire correctly: ${JSON.stringify(readyAfterReady)}`);
  }

  await page.reload();
  await page.locator("#done-title", { hasText: "Ta commande est prête !" }).waitFor();
  await page.waitForTimeout(900);
  const readyAfterClientReload = await page.evaluate(() => ({
    soundPlays: window.__readyAlertSoundPlays,
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v2")),
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
    readyAfterClientReload.soundPlays !== 0 ||
    readyAfterClientReload.vibrationCount !== 0 ||
    !readyAfterClientReload.stored?.orders?.some((order) => order.readyNotified === true)
  ) {
    throw new Error(`Ready alert replayed after reload: ${JSON.stringify(readyAfterClientReload)}`);
  }

  const soundToggle = kitchenPage.locator("button.kitchen-sound-toggle");
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

  const deniedPermission = await deniedPage.evaluate(() => ({
    stored: JSON.parse(window.localStorage.getItem("sarah-burger-ready-alert-v2")),
  }));
  if (
    deniedPermission.stored?.audioUnlocked !== true ||
    !deniedPermission.stored?.orders?.[0]?.orderId
  ) {
    throw new Error(`Page alert preference was not stored: ${JSON.stringify(deniedPermission)}`);
  }

  const deniedTicket = kitchenPage.locator(".ticket", { hasText: "Noe" });
  await deniedTicket.waitFor();
  await deniedTicket.locator("footer .primary-action").click();
  await deniedTicket.locator(".status-pill", { hasText: "En préparation" }).waitFor();
  await deniedTicket.locator("footer .primary-action").click();
  await deniedTicket.locator(".status-pill", { hasText: "Prête" }).waitFor();
  await deniedPage.locator("#done-title", { hasText: "Ta commande est prête !" }).waitFor();

  const deniedReadyAlert = await deniedPage.evaluate(() => ({
    soundPlays: window.__readyAlertSoundPlays,
    vibrationCount: window.__readyVibrations.length,
  }));
  if (
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
    { width: 320, height: 568, name: "mobile-320x568" },
    { width: 360, height: 640, name: "mobile-360x640" },
    { width: 375, height: 667, name: "mobile-375x667" },
    { width: 390, height: 844, name: "mobile-390x844" },
    { width: 393, height: 852, name: "mobile-393x852" },
    { width: 412, height: 915, name: "mobile-412x915" },
    { width: 430, height: 932, name: "mobile-430x932" },
    { width: 667, height: 375, name: "landscape-667x375" },
    { width: 768, height: 1024, name: "tablet-768x1024" },
    { width: 1280, height: 900, name: "desktop-1280x900" },
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
    const stickyIdentity = await checkStickyActions(viewportPage, `${viewport.name} identity`);
    await viewportPage.locator('input[placeholder="Ex. Sarah"]').fill("Vue");
    await viewportPage.getByRole("button", { name: "Continuer" }).click();
    const stickyCustomize = await checkStickyActions(viewportPage, `${viewport.name} customize`);
    await viewportPage.locator(".toppings-grid button.choice-card").nth(2).click();
    const viewportOnions = await assertMascotVisible(
      viewportPage,
      viewportPage.locator(".toppings-grid button.choice-card").nth(2),
      `Oignons frits ${viewport.name}`,
    );
    await viewportPage.locator("button.sauce-card").nth(5).click();
    const viewportSpicy = await assertMascotVisible(
      viewportPage,
      viewportPage.locator("button.sauce-card").nth(5),
      `Sauce piquante ${viewport.name}`,
    );
    await viewportPage.locator("button.sauce-card").nth(6).click();
    const viewportMustard = await assertMascotVisible(
      viewportPage,
      viewportPage.locator("button.sauce-card").nth(6),
      `Moutarde ${viewport.name}`,
    );
    await viewportPage.getByRole("button", { name: "Choisir les nachos" }).click();
    const stickyNachos = await checkStickyActions(viewportPage, `${viewport.name} nachos`);
    await viewportPage.locator(".nachos-decision-grid").waitFor();
    await viewportPage.getByRole("button", { name: /Non merci/ }).click();
    await openKitchen(viewportPage);
    const kitchenMetrics = await checkOverflow(viewportPage);
    if (kitchenMetrics.overflowing) {
      throw new Error(`Kitchen layout overflows horizontally at ${viewport.name}.`);
    }
    viewportMetrics.push({
      name: viewport.name,
      orderMetrics,
      kitchenMetrics,
      stickyMetrics: { identity: stickyIdentity, customize: stickyCustomize, nachos: stickyNachos },
      mascotMetrics: { onions: viewportOnions, spicy: viewportSpicy, mustard: viewportMustard },
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
