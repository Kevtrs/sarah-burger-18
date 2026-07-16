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
  await page.goto(`${appUrl}/#commande`);
  await page.locator('input[placeholder="Ex. Sarah"]').fill(guestName);
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

  await openKitchen(page);
  await page.locator(".ticket").waitFor();
  await page.waitForTimeout(800);

  const initialSoundStarts = await page.evaluate(() => window.__newOrderDingStarts || 0);
  if (initialSoundStarts !== 0) {
    throw new Error("Kitchen sound played during the first orders snapshot.");
  }

  const remoteOrderPage = await mobileContext.newPage();
  recordErrors(remoteOrderPage, consoleErrors);
  await submitOrderFromPage(remoteOrderPage, "Mila", 0, 0);
  await remoteOrderPage.close();

  await page.locator(".ticket", { hasText: "Mila" }).waitFor();
  await page.waitForTimeout(900);

  const soundAfterNewOrder = await page.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterNewOrder !== 2) {
    throw new Error(`Expected one new-order ding, got ${soundAfterNewOrder} oscillator starts.`);
  }

  const kitchenBefore = await page.locator(".ticket").first().innerText();
  await page.locator(".ticket footer .primary-action").first().click();
  await waitForTicketStatus(page, "En préparation");
  await page.waitForTimeout(800);

  const soundAfterStatusChange = await page.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterStatusChange !== soundAfterNewOrder) {
    throw new Error("Kitchen sound replayed after a status change.");
  }

  const soundToggle = page.locator('button[aria-pressed]');
  if ((await soundToggle.count()) !== 1) throw new Error("Kitchen sound toggle not found.");
  await soundToggle.click();
  const storedSoundOff = await page.evaluate(() =>
    window.localStorage.getItem("sarah-burger-kitchen-sound-enabled"),
  );
  if (storedSoundOff !== "off") throw new Error("Kitchen sound preference was not stored as off.");

  const mutedOrderPage = await mobileContext.newPage();
  recordErrors(mutedOrderPage, consoleErrors);
  await submitOrderFromPage(mutedOrderPage, "Lou", 2, 4);
  await mutedOrderPage.close();

  await page.locator(".ticket", { hasText: "Lou" }).waitFor();
  await page.waitForTimeout(900);

  const soundAfterMutedOrder = await page.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterMutedOrder !== soundAfterNewOrder) {
    throw new Error("Kitchen sound played while muted.");
  }

  await soundToggle.click();
  const storedSoundOn = await page.evaluate(() =>
    window.localStorage.getItem("sarah-burger-kitchen-sound-enabled"),
  );
  if (storedSoundOn !== "on") throw new Error("Kitchen sound preference was not stored as on.");

  await page.reload();
  await openKitchen(page);
  await page.locator('button[aria-pressed="true"]', { hasText: "Son" }).waitFor();
  await page.waitForTimeout(800);
  const soundAfterReload = await page.evaluate(() => window.__newOrderDingStarts || 0);
  if (soundAfterReload !== 0) {
    throw new Error("Kitchen sound played after reloading existing orders.");
  }

  await page.locator(".ticket footer .primary-action").first().click();
  await waitForTicketStatus(page, "Prête");
  await page.locator(".ticket footer .primary-action").first().click();
  await page.getByRole("tab", { name: "Servies" }).click();
  await waitForTicketStatus(page, "Servie");
  const kitchenAfter = await page.locator(".ticket").first().innerText();

  if (!kitchenAfter.includes("Servie")) {
    throw new Error("Kitchen status did not advance to served.");
  }

  const mobileMetrics = await checkOverflow(page);
  if (mobileMetrics.overflowing) throw new Error("Mobile layout overflows horizontally.");

  const mobileShot = path.join(screenshotDir, "mobile-kitchen.png");
  await page.screenshot({ path: mobileShot, fullPage: true });
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
