import { MessageCircle, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function formatMessageTime(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function OrderMessages({
  disabled = false,
  guestName = "",
  mode = "guest",
  orderId,
  orderNumber,
  store,
}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const isKitchen = mode === "kitchen";
  const trimmedDraft = draft.trim();

  useEffect(() => {
    if (!orderId || !store.subscribeOrderMessages) return undefined;

    return store.subscribeOrderMessages(
      orderId,
      setMessages,
      (err) => setError(err.message || "Messages indisponibles."),
    );
  }, [orderId, store]);

  const helperText = useMemo(() => {
    if (disabled) return "Conversation fermee pour cette commande.";
    if (isKitchen) return guestName ? `Repondre a ${guestName}.` : "Repondre au client.";
    return "Une question, un retard, un detail ? Ecris au stand ici.";
  }, [disabled, guestName, isKitchen]);

  async function submit(event) {
    event.preventDefault();
    if (!trimmedDraft || isSending || disabled) return;

    setIsSending(true);
    setError("");
    try {
      await store.sendOrderMessage(orderId, trimmedDraft, isKitchen ? "kitchen" : "guest");
      setDraft("");
    } catch (err) {
      setError(err.message || "Message non envoye.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className={`order-messages order-messages-${mode}`} aria-label={`Messages commande ${orderNumber}`}>
      <header className="order-messages__header">
        <MessageCircle aria-hidden="true" />
        <div>
          <strong>{isKitchen ? "Messages client" : "Message au stand"}</strong>
          <small>Commande #{orderNumber}</small>
        </div>
      </header>

      <div className="order-messages__thread" aria-live="polite">
        {messages.length === 0 ? (
          <p className="order-messages__empty">{helperText}</p>
        ) : (
          messages.map((message) => (
            <article
              className={`message-bubble message-${message.sender}`}
              key={message.id}
            >
              <div>
                <strong>{message.sender === "kitchen" ? "Cuisine" : "Client"}</strong>
                <time dateTime={new Date(message.createdAtMs).toISOString()}>
                  {formatMessageTime(message.createdAtMs)}
                </time>
              </div>
              <p>{message.text}</p>
            </article>
          ))
        )}
      </div>

      <form className="order-messages__form" onSubmit={submit}>
        <label className="sr-only" htmlFor={`message-${mode}-${orderId}`}>
          {isKitchen ? "Reponse cuisine" : "Message au stand"}
        </label>
        <input
          id={`message-${mode}-${orderId}`}
          value={draft}
          maxLength={180}
          placeholder={isKitchen ? "Repondre..." : "Ecrire au stand..."}
          disabled={disabled || isSending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="secondary-action compact message-send-button"
          type="submit"
          disabled={!trimmedDraft || disabled || isSending}
        >
          <Send aria-hidden="true" />
          Envoyer
        </button>
      </form>

      {error && <p className="order-messages__error">{error}</p>}
    </section>
  );
}
