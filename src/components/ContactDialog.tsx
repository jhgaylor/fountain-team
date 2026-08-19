import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FountainClient } from "../api/client";
import type { Teammate } from "../api/types";
import { contactSummary, describeContactError, formatPhone, normalizePhone } from "../lib/contact";

/**
 * "Give email & phone": buys an AgentMail inbox and an AgentPhone number for
 * one teammate (POST /api/team/:agent_id/contact). The one thing to fill in
 * is your own phone number — texts from it to the teammate's new number
 * arrive in this thread as prompts; texts from anyone else are ignored. Says
 * plainly that both are billed before Confirm.
 */
export function ContactDialog({
  client,
  teammate,
  onClose,
  onProvisioned,
  toast,
}: {
  client: FountainClient;
  teammate: Teammate;
  onClose: () => void;
  /** the teammate as the server returned it — with `contact` */
  onProvisioned: (t: Teammate) => void;
  toast: (t: string, k?: "info" | "error") => void;
}) {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const normalized = normalizePhone(number);
  const typed = number.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!normalized) {
      setFieldError("Your phone number must be a phone number with country code, e.g. +15551234567");
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const t = await client.provisionContact(teammate.agent_id, normalized);
      toast(contactSummary(t.name ?? teammate.name, t.contact));
      onProvisioned(t);
    } catch (err) {
      const d = describeContactError(err);
      if (d.field === "prompt_from_number") setFieldError(d.message);
      else setError(d.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-root">
      <div className="backdrop" onClick={busy ? undefined : onClose} />
      <form className="modal add contact" onSubmit={submit} role="dialog" aria-label={`Give ${teammate.name} an email and phone`}>
        <header>
          <h2>Give {teammate.name} an email &amp; phone</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </header>
        <p className="muted small">
          {teammate.name} gets their own inbox and number, and from their next turn the tools to use them — send, reply to and read email; send and
          list texts. They answer a text with a text (their <code>sms_send</code> tool), not in this chat.
        </p>
        <label>
          Your phone number
          <input
            ref={inputRef}
            type="tel"
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setFieldError(null);
            }}
            placeholder="+1 555 123 4567"
            autoComplete="tel"
            required
            className={fieldError ? "invalid" : ""}
            aria-invalid={!!fieldError}
            aria-describedby="contact-number-hint"
            disabled={busy}
          />
          <span className="hint" id="contact-number-hint">
            Texts from it to {teammate.name}'s new number become prompts in this thread.
            {typed && normalized ? (
              <>
                {" "}
                Stored as <span className="mono">{formatPhone(normalized)}</span>.
              </>
            ) : null}
          </span>
          {fieldError && <span className="error-inline small">{fieldError}</span>}
        </label>
        <div className="cost-note small">
          Provisions an AgentMail inbox and an AgentPhone number for this teammate only; <b>both are billed</b>. Texts from any other number are ignored.
          Release them any time from the thread.
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !typed}>
            {busy ? "Provisioning…" : "Confirm — buy email & phone"}
          </button>
        </div>
      </form>
    </div>
  );
}
