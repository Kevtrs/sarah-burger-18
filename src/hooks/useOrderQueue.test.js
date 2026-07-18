import { describe, expect, it } from "vitest";
import { buildQueueInfo } from "./useOrderQueue";

describe("buildQueueInfo", () => {
  const queue = [
    { id: "order-a", number: 18, status: "received" },
    { id: "order-b", number: 19, status: "preparing" },
    { id: "order-c", number: 20, status: "ready" },
    { id: "order-d", number: 21, status: "received" },
  ];

  it("counts only active burgers before the current order", () => {
    const info = buildQueueInfo(
      { orderId: "order-d", number: 21, lastStatus: "received" },
      queue,
    );

    expect(info.visible).toBe(true);
    expect(info.aheadCount).toBe(2);
    expect(info.title).toBe("2 burgers avant toi");
  });

  it("does not show the queue once the order is ready", () => {
    const info = buildQueueInfo(
      { orderId: "order-c", number: 20, lastStatus: "ready" },
      queue,
    );

    expect(info.visible).toBe(false);
  });

  it("marks a preparing order as on the grill", () => {
    const info = buildQueueInfo(
      { orderId: "order-b", number: 19, lastStatus: "preparing" },
      queue,
    );

    expect(info.title).toBe("Sur le grill");
    expect(info.shortLabel).toBe("en préparation");
  });
});
