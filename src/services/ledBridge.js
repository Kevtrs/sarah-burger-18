const BRIDGE_URL = "http://127.0.0.1:8765";

export async function notifyLedBridge(order, status) {
  if (!order?.number) return;

  try {
    await fetch(`${BRIDGE_URL}/display`, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: Number(order.number),
        guestName: order.guestName || "",
        status,
      }),
      signal: AbortSignal.timeout?.(1800),
    });
  } catch {
    // Le pont LED est facultatif : une panne locale ne doit jamais bloquer la cuisine.
  }
}

export async function testLedBridge() {
  const response = await fetch(`${BRIDGE_URL}/health`, {
    mode: "cors",
    signal: AbortSignal.timeout?.(1800),
  });
  if (!response.ok) throw new Error("Pont LED indisponible");
  return response.json();
}
