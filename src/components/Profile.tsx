import { useEffect, useMemo, useState } from "react";
import type { FountainClient } from "../api/client";
import { describeError } from "../api/client";
import type { Agent, Environment, Teammate } from "../api/types";
import { formatUsage } from "../lib/format";
import { brainsFrom, labelFor, personaPrompt, type Brain, type Catalog } from "../lib/brain";
import { Avatar } from "./Avatar";
import { Markdown } from "./Markdown";
import { SkillsTab } from "./SkillsTab";
import { AppsTab } from "./AppsTab";

type Tab = "profile" | "skills" | "apps";

/**
 * Customize a teammate (after Grok Bot's bot profile and OpenMausBot's
 * profile + connected-apps panels): who they are — brain, what they do —
 * and what they can do: skills and connected apps, each a tab with a
 * catalog to pick from. Everything is edited here, on the agent behind
 * them (PUT /api/agents/:id); nothing sends you to Fountain. Skills and
 * apps land when the teammate's computer is next set up, so a change to
 * those offers to restart it.
 */
export function Profile({
  client,
  teammate,
  onClose,
  onAgentChanged,
  onRetire,
  initialTab = "profile",
}: {
  client: FountainClient;
  teammate: Teammate;
  onClose: () => void;
  onAgentChanged?: () => void;
  /** End the current computer so the next message starts a fresh one with the new skills/apps. */
  onRetire?: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [creds, setCreds] = useState<Record<string, boolean>>({});
  const [persona, setPersona] = useState<string | null>(null);
  const [saving, setSaving] = useState<"brain" | "persona" | null>(null);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** skills/apps changed since opening: they need a fresh computer */
  const [pending, setPending] = useState(false);
  const conv = teammate.conversation;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.getAgent(teammate.agent_id),
      client.listEnvironments().catch(() => []),
      client.getCatalog().catch(() => null),
      client.inferenceCredentials().catch(() => ({}) as Record<string, boolean>),
    ])
      .then(([a, e, cat, cr]) => {
        if (cancelled) return;
        setAgent(a);
        setEnvs(e);
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

  const a = agent ?? teammate.agent;
  const brains = useMemo(() => (catalog ? brainsFrom(catalog, creds) : []), [catalog, creds]);
  const brainKnown = brains.some((b) => b.model === a.model);
  const skillCount = a.skills?.length ?? 0;
  const appCount = Object.keys(a.mcp_servers ?? {}).length;

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

  /** The tabs call this with the agent the server returned after a skills/apps write. */
  const onAgentUpdated = (next: Agent) => {
    setAgent(next);
    setPending(true);
    onAgentChanged?.();
  };

  const envName = (id: string | null) => (id ? (envs.find((e) => e.id === id)?.name ?? id.slice(0, 8)) : null);
  const usedEnv = conv.environment_id ?? a.environment_id;
  const retired = conv.status === "terminated";
  const freshCheap = conv.turn_count === 0;

  return (
    <div className="modal-root">
      <div className="backdrop" onClick={onClose} />
      <div className="modal wide profile" role="dialog" aria-label={`Customize ${teammate.name}`}>
        <header>
          <div className="row">
            <Avatar agent={a} name={teammate.name} client={client} size={40} />
            <div>
              <h2>Customize {teammate.name}</h2>
              <div className="muted small">
                {teammate.name !== a.name && <>agent <b>{a.name}</b> · </>}
                {labelFor(a.model)} · {a.runtime}
              </div>
            </div>
          </div>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="tabs" role="tablist" aria-label="Customize">
          <button type="button" role="tab" aria-selected={tab === "profile"} className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            Profile
          </button>
          <button type="button" role="tab" aria-selected={tab === "skills"} className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>
            Skills{skillCount > 0 && <span className="count">{skillCount}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "apps"} className={tab === "apps" ? "active" : ""} onClick={() => setTab("apps")}>
            Apps{appCount > 0 && <span className="count">{appCount}</span>}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {pending && !retired && (
          <div className="apply-banner" role="status">
            <div>
              <b>Saved.</b> {teammate.name} picks this up on their next computer
              {freshCheap ? " — nothing has happened on this one yet, so restarting it costs nothing." : " — the one they are on now was set up before the change."}
            </div>
            {onRetire && (
              <button type="button" className="small" onClick={onRetire}>
                {freshCheap ? "Restart their computer" : "Restart their computer…"}
              </button>
            )}
          </div>
        )}
        {pending && retired && (
          <div className="apply-banner" role="status">
            <b>Saved.</b> This thread is retired, so {teammate.name}'s next message already starts on a computer with this.
          </div>
        )}

        {tab === "profile" && (
          <>
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
                {conv.sandbox?.runner ? <span className="muted"> · on {conv.sandbox.runner.name}</span> : a.sandbox_provider ? <span className="muted"> · {a.sandbox_provider}</span> : null}
              </dd>
              <dt>Can do</dt>
              <dd>
                {skillCount === 0 && appCount === 0 ? (
                  <span className="muted">
                    No skills or apps yet —{" "}
                    <button type="button" className="linkish" onClick={() => setTab("skills")}>
                      add a skill
                    </button>{" "}
                    or{" "}
                    <button type="button" className="linkish" onClick={() => setTab("apps")}>
                      connect an app
                    </button>
                    .
                  </span>
                ) : (
                  <>
                    <button type="button" className="linkish" onClick={() => setTab("skills")}>
                      {skillCount} skill{skillCount === 1 ? "" : "s"}
                    </button>
                    {" · "}
                    <button type="button" className="linkish" onClick={() => setTab("apps")}>
                      {appCount} app{appCount === 1 ? "" : "s"}
                    </button>
                  </>
                )}
              </dd>
            </dl>

            <details className="profile-system">
              <summary>Details</summary>
              <dl className="profile-grid profile-details">
                <dt>Environment</dt>
                <dd>
                  {envName(usedEnv) ?? <span className="muted">none</span>}
                  {conv.environment_id && conv.environment_id !== a.environment_id && <span className="muted"> (this conversation; the agent's default is {envName(a.environment_id) ?? "none"})</span>}
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
                {conv.sandbox && (
                  <>
                    <dt>Sandbox</dt>
                    <dd className="mono small">{conv.sandbox.sprite_name}</dd>
                  </>
                )}
              </dl>
              {a.system && (
                <>
                  <div className="muted small" style={{ marginTop: 8 }}>
                    System prompt
                  </div>
                  <div className="profile-system-body">
                    <Markdown text={a.system} />
                  </div>
                </>
              )}
            </details>
          </>
        )}

        {tab === "skills" && <SkillsTab client={client} agent={agent} name={teammate.name} onAgent={onAgentUpdated} />}
        {tab === "apps" && <AppsTab client={client} agent={agent} teammate={teammate} envs={envs} onEnvs={setEnvs} onAgent={onAgentUpdated} />}
      </div>
    </div>
  );
}
