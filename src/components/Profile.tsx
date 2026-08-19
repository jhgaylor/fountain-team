import { useEffect, useMemo, useState } from "react";
import type { FountainClient } from "../api/client";
import { describeError } from "../api/client";
import type { Agent, Environment, Teammate, Vault } from "../api/types";
import { formatUsage } from "../lib/format";
import { brainsFrom, labelFor, personaPrompt, type Brain, type Catalog } from "../lib/brain";
import { Avatar } from "./Avatar";
import { Markdown } from "./Markdown";

/**
 * Who a teammate is (after OpenMausBot's bot profile / plugins panel): the
 * agent behind them — model, runtime, description, system prompt, skills,
 * MCP servers, environment, vault — and the conversation that is their
 * thread. Read-only; the agent is edited in Fountain.
 */
export function Profile({
  client,
  teammate,
  onClose,
  onAgentChanged,
  fountainUrl,
}: {
  client: FountainClient;
  teammate: Teammate;
  onClose: () => void;
  onAgentChanged?: () => void;
  fountainUrl: string;
}) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [creds, setCreds] = useState<Record<string, boolean>>({});
  const [persona, setPersona] = useState<string | null>(null);
  const [saving, setSaving] = useState<"brain" | "persona" | null>(null);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conv = teammate.conversation;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.getAgent(teammate.agent_id),
      client.listEnvironments().catch(() => []),
      client.listVaults().catch(() => []),
      client.getCatalog().catch(() => null),
      client.inferenceCredentials().catch(() => ({}) as Record<string, boolean>),
    ])
      .then(([a, e, v, cat, cr]) => {
        if (cancelled) return;
        setAgent(a);
        setEnvs(e);
        setVaults(v);
        setCatalog(cat);
        setCreds(cr);
      })
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [client, teammate.agent_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const envName = (id: string | null) => (id ? (envs.find((e) => e.id === id)?.name ?? id.slice(0, 8)) : null);
  const vaultName = (id: string | null) => (id ? (vaults.find((v) => v.id === id)?.name ?? id.slice(0, 8)) : null);
  const a = agent ?? teammate.agent;
  const brains = useMemo(() => (catalog ? brainsFrom(catalog, creds) : []), [catalog, creds]);
  const brainKnown = brains.some((b) => b.model === a.model);

  const changeBrain = async (model: string) => {
    const b: Brain | undefined = brains.find((x) => x.model === model);
    if (!b || !agent) return;
    setSaving("brain");
    try {
      setAgent(await client.updateAgent(agent.id, { model: b.model, runtime: b.runtime }));
      onAgentChanged?.();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(null);
    }
  };

  const savePersona = async () => {
    if (!agent || persona === null) return;
    setSaving("persona");
    try {
      setAgent(await client.updateAgent(agent.id, { description: persona.trim(), system: personaPrompt(teammate.name, persona) }));
      setPersona(null);
      onAgentChanged?.();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(null);
    }
  };
  const skills = (a.skills ?? []) as Array<Record<string, unknown>>;
  const mcp = Object.entries(a.mcp_servers ?? {}) as Array<[string, Record<string, unknown>]>;
  const usedEnv = conv.environment_id ?? a.environment_id;

  return (
    <div className="modal-root">
      <div className="backdrop" onClick={onClose} />
      <div className="modal wide profile" role="dialog" aria-label={`About ${teammate.name}`}>
        <header>
          <div className="row">
            <Avatar agent={a} name={teammate.name} client={client} size={40} />
            <div>
              <h2>{teammate.name}</h2>
              <div className="muted small">
                {teammate.name !== a.name && <>agent <b>{a.name}</b> · </>}
                {a.runtime} · {a.model}
              </div>
            </div>
          </div>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {error && <div className="error">{error}</div>}

        <label className="profile-field">
          Brain
          <select value={brainKnown ? a.model : "__current"} disabled={!agent || !brains.length || saving === "brain"} onChange={(e) => void changeBrain(e.target.value)}>
            {!brainKnown && <option value="__current">{labelFor(a.model)} (current)</option>}
            {brains.map((b) => (
              <option key={b.model} value={b.model}>
                {b.label}
                {b.available ? "" : " — no key on the account"}
              </option>
            ))}
          </select>
          <span className="hint">The runtime follows the brain. A change applies from their next turn; the conversation continues.</span>
        </label>

        <label className="profile-field">
          What they do
          <textarea
            rows={2}
            value={persona ?? a.description ?? ""}
            placeholder="e.g. reviews pull requests on the api repo and keeps the changelog honest"
            onChange={(e) => setPersona(e.target.value)}
            disabled={!agent || saving === "persona"}
            maxLength={600}
          />
          {persona !== null && persona !== (a.description ?? "") && (
            <div className="row end">
              <button type="button" className="secondary small" onClick={() => setPersona(null)} disabled={saving === "persona"}>
                Cancel
              </button>
              <button type="button" className="small" onClick={() => void savePersona()} disabled={saving === "persona"}>
                {saving === "persona" ? "Saving…" : "Save"}
              </button>
            </div>
          )}
          <span className="hint">One line is plenty — it becomes their description and the start of their instructions.</span>
        </label>

        <dl className="profile-grid">
          <dt>Computer</dt>
          <dd>
            <span className={`presence inline ${teammate.presence.state}`} />
            {teammate.presence.label}
            {conv.sandbox && <span className="mono muted"> · {conv.sandbox.sprite_name}</span>}
            {a.sandbox_provider && <span className="muted"> · {a.sandbox_provider}</span>}
          </dd>
          <dt>Environment</dt>
          <dd>
            {envName(usedEnv) ?? <span className="muted">none</span>}
            {conv.environment_id && conv.environment_id !== a.environment_id && <span className="muted"> (this conversation; the agent's default is {envName(a.environment_id) ?? "none"})</span>}
          </dd>
          <dt>Vault</dt>
          <dd>{vaultName(conv.vault_id) ?? <span className="muted">none</span>}</dd>
          <dt>Skills</dt>
          <dd>
            {skills.length === 0 && <span className="muted">none</span>}
            {skills.length > 0 && (
              <ul className="plain">
                {skills.map((s, i) => (
                  <li key={i}>
                    {typeof s.source === "string" ? (
                      <a href={`https://github.com/${s.source}`} target="_blank" rel="noreferrer">
                        {s.source}
                      </a>
                    ) : (
                      <span>{typeof s.name === "string" ? s.name : `skill ${i + 1}`}</span>
                    )}
                    {typeof s.content === "string" && <span className="muted small"> · inline</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt>MCP servers</dt>
          <dd>
            {mcp.length === 0 && <span className="muted">none</span>}
            {mcp.length > 0 && (
              <ul className="plain">
                {mcp.map(([name, def]) => (
                  <li key={name}>
                    <b>{name}</b>
                    <span className="muted small mono">
                      {" "}
                      · {typeof def.type === "string" ? def.type : def.command ? "stdio" : "?"}
                      {typeof def.url === "string" ? ` ${def.url}` : typeof def.command === "string" ? ` ${def.command}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Conversation</dt>
          <dd>
            <span className="mono small">{conv.id}</span>
            <span className="muted">
              {" "}
              · {conv.turn_count} turn{conv.turn_count === 1 ? "" : "s"}
              {formatUsage(teammate.usage_total) ? ` · ${formatUsage(teammate.usage_total)}` : ""}
            </span>
          </dd>
        </dl>

        {a.system && (
          <details className="profile-system">
            <summary>System prompt</summary>
            <div className="profile-system-body">
              <Markdown text={a.system} />
            </div>
          </details>
        )}

        <div className="row end">
          <a className="button secondary small" href={`${fountainUrl}/agents/${a.id}/edit`} target="_blank" rel="noreferrer">
            Edit agent in Fountain
          </a>
          <a className="button secondary small" href={`${fountainUrl}/conversations/${conv.id}`} target="_blank" rel="noreferrer">
            Conversation in Fountain
          </a>
        </div>
      </div>
    </div>
  );
}
