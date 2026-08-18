import { useState, type FormEvent } from "react";
import { FountainClient, describeError } from "../api/client";
import { normalizeBaseUrl, type Settings } from "../lib/settings";

interface Props {
  initial: Settings | null;
  onConnected: (settings: Settings, email: string) => void;
  onCancel?: () => void;
}

/** Where is Fountain, and which key. Verified with `GET /api/auth/me` before it is kept. */
export function SettingsScreen({ initial, onConnected, onCancel }: Props) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "https://fountain.inevitable.fyi");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const settings: Settings = { baseUrl: normalizeBaseUrl(baseUrl), apiKey: apiKey.trim() };
    try {
      const me = await new FountainClient(settings).me();
      onConnected(settings, me.email);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <form className="settings-card" onSubmit={submit}>
        <h1>Team</h1>
        <p className="muted">
          Your Fountain agents as teammates, one conversation each. This app talks only to the
          Fountain API; the URL and key stay in this browser.
        </p>
        <label>
          Fountain URL
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://fountain.example.com"
            autoComplete="url"
          />
        </label>
        <label>
          API key
          <input
            type="password"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="fnt_…"
            autoComplete="off"
          />
        </label>
        <p className="muted small">
          Make one under <em>Account → API keys</em> in Fountain. The server must list this site
          in <code>API_CORS_ORIGINS</code>.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="row end">
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
