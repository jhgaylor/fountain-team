import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Agent, Environment, Vault } from "../api/types";
import { describeError, type FountainClient } from "../api/client";
import { brainsFrom, defaultBrain, personaPrompt, type Brain, type Catalog } from "../lib/brain";
import { pickName } from "../lib/names";

interface Props {
  client: FountainClient;
  onTeam: Set<string>;
  onAdded: (agentId: string) => void;
  onClose: () => void;
}

/**
 * Add a teammate the way a messaging app adds a contact (after Grok Bot /
 * OpenMausBot): a name — already filled in — a brain, and one line about
 * what they do. Everything Fountain can configure on an agent (runtime,
 * environment, vault, skills, MCP servers, sandbox provider) is defaulted
 * by this app: runtime follows the brain, the computer is the default
 * provider with no environment, and a generated avatar is attached when the
 * account can make one. Tuning lives in Fountain; "an agent you already
 * have" is the second tab for people who built one there.
 */
export function AddDialog({ client, onTeam, onAdded, onClose }: Props) {
  const [tab, setTab] = useState<"new" | "existing">("new");
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-root">
      <div className="backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal add" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <header>
          <h2 id="add-title">{tab === "new" ? "New teammate" : "Add an agent you already have"}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {tab === "new" ? (
          <NewTeammate client={client} onAdded={onAdded} onClose={onClose} onExisting={() => setTab("existing")} />
        ) : (
          <ExistingAgent client={client} onTeam={onTeam} onAdded={onAdded} onClose={onClose} onNew={() => setTab("new")} />
        )}
      </div>
    </div>
  );
}

// ── the easy path ───────────────────────────────────────────────────────────

function NewTeammate({ client, onAdded, onClose, onExisting }: { client: FountainClient; onAdded: (id: string) => void; onClose: () => void; onExisting: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [brains, setBrains] = useState<Brain[]>([]);
  const [takenNames, setTakenNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [persona, setPersona] = useState("");
  const [avatar, setAvatar] = useState<{ data: string; media_type: string } | null>(null);
  const [avatarState, setAvatarState] = useState<"idle" | "making" | "unavailable">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameTouched = useRef(false);

  // catalog + credentials + existing names, then a generated name and the default brain
  useEffect(() => {
    let cancelled = false;
    Promise.all([client.getCatalog(), client.inferenceCredentials().catch(() => ({})), client.listAgents().catch(() => [] as Agent[])])
      .then(([cat, creds, agents]) => {
        if (cancelled) return;
        setCatalog(cat);
        const bs = brainsFrom(cat, creds);
        setBrains(bs);
        setModel(defaultBrain(bs)?.model ?? "");
        const taken = agents.map((a) => a.name);
        setTakenNames(taken);
        setName((n) => n || pickName(taken));
      })
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    window.setTimeout(() => nameRef.current?.select(), 50);
  }, [catalog]);

  // the in-flight generation, so a submit that lands mid-generation can wait for it
  const avatarPending = useRef<Promise<{ data: string; media_type: string } | null> | null>(null);
  const makeAvatar = useCallback(async () => {
    const bases = catalog?.avatar?.bases ?? [];
    const moods = catalog?.avatar?.moods ?? [];
    if (!bases.length || !moods.length) return;
    setAvatarState("making");
    const p = client
      .generateAvatar(bases[Math.floor(Math.random() * bases.length)]!, moods[Math.floor(Math.random() * moods.length)]!)
      .then((a) => {
        setAvatar(a);
        setAvatarState("idle");
        return a;
      })
      .catch(() => {
        // no OpenAI key on the account, or the generator is down: initials are fine
        setAvatar(null);
        setAvatarState("unavailable");
        return null;
      });
    avatarPending.current = p;
    await p;
  }, [client, catalog]);

  // one avatar on open, best effort
  useEffect(() => {
    if (catalog && avatarState === "idle" && !avatar) void makeAvatar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const brain = brains.find((b) => b.model === model) ?? null;
  const grouped = useMemo(() => {
    const g = new Map<string, Brain[]>();
    for (const b of brains) {
      const arr = g.get(b.provider);
      if (arr) arr.push(b);
      else g.set(b.provider, [b]);
    }
    return [...g.entries()];
  }, [brains]);

  const reroll = () => {
    setName(pickName([...takenNames, name]));
    nameTouched.current = false;
  };

  const canAdd = !busy && !!brain && name.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd || !brain) return;
    setError(null);
    const who = name.trim();
    try {
      setBusy("Creating the agent…");
      const agent = await client.createAgent({
        name: who,
        model: brain.model,
        runtime: brain.runtime,
        description: persona.trim(),
        system: personaPrompt(who, persona),
      });
      // an avatar still being drawn is worth a few seconds; a failed one is not worth a retry
      let pic = avatar;
      if (!pic && avatarPending.current) {
        setBusy("Finishing the avatar…");
        pic = await Promise.race([avatarPending.current, new Promise<null>((r) => window.setTimeout(() => r(null), 25_000))]);
      }
      if (pic) {
        setBusy("Attaching the avatar…");
        await client.putAvatar(agent.id, pic.data, pic.media_type).catch(() => undefined);
      }
      setBusy("Starting their computer…");
      const t = await client.addTeammate({ agent_id: agent.id, name: who });
      onAdded(t.agent_id);
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="add-top">
        <button
          type="button"
          className="add-avatar"
          onClick={() => void makeAvatar()}
          disabled={avatarState === "making" || avatarState === "unavailable"}
          title={avatarState === "unavailable" ? "Avatars need an OpenAI key on the account; initials it is" : "Another look"}
          aria-label="Generate another avatar"
        >
          {avatar ? (
            <img src={`data:${avatar.media_type};base64,${avatar.data}`} alt="" />
          ) : (
            <span className="initials">{avatarState === "making" ? "…" : initials(name) || "?"}</span>
          )}
          {avatarState !== "unavailable" && <span className="redo">↻</span>}
        </button>
        <label className="grow">
          Name
          <div className="row">
            <input
              ref={nameRef}
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
              autoComplete="off"
              placeholder="Pick a name"
            />
            <button type="button" className="icon" onClick={reroll} title="Another name" aria-label="Another name">
              🎲
            </button>
          </div>
        </label>
      </div>

      <label>
        Brain
        {catalog === null ? (
          <select disabled>
            <option>Loading…</option>
          </select>
        ) : (
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {grouped.map(([provider, list]) => (
              <optgroup key={provider} label={providerLabel(provider)}>
                {list.map((b) => (
                  <option key={b.model} value={b.model}>
                    {b.label.split(" · ")[0]}
                    {b.available ? "" : " — no key on the account"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {brain && !brain.available && (
          <span className="hint error-inline">
            No {providerLabel(brain.provider)} credential on the account — they won't be able to answer until one is added under Account → Inference credentials in Fountain.
          </span>
        )}
      </label>

      <label>
        What they do <span className="muted">(optional)</span>
        <textarea
          rows={2}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="e.g. reviews pull requests on the api repo and keeps the changelog honest"
          maxLength={600}
        />
        <span className="hint">One line is plenty. Becomes their description and the start of their instructions; change it any time in Fountain.</span>
      </label>

      <p className="muted small add-fineprint">
        They get their own computer (the default provider, a clean environment) and one ongoing conversation with you. Skills, MCP servers, environments, vaults and the rest are
        there in Fountain when you want them —{" "}
        <button type="button" className="linkish" onClick={onExisting}>
          or add an agent you already have
        </button>
        .
      </p>

      {error && <div className="error">{error}</div>}
      <div className="row end">
        <button type="button" className="secondary" onClick={onClose} disabled={!!busy}>
          Cancel
        </button>
        <button type="submit" disabled={!canAdd}>
          {busy ?? "Add to team"}
        </button>
      </div>
    </form>
  );
}

function providerLabel(p: string): string {
  return p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : p === "google" ? "Google" : p;
}

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!)
    .join("")
    .toUpperCase();
}

// ── the tuned path: an agent that already exists ────────────────────────────

function ExistingAgent({ client, onTeam, onAdded, onClose, onNew }: Props & { onNew: () => void }) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [envId, setEnvId] = useState("");
  const [vaultId, setVaultId] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listAgents(), client.listEnvironments(), client.listVaults()])
      .then(([a, e, v]) => {
        if (cancelled) return;
        const addable = a.filter((x) => !onTeam.has(x.id));
        setAgents(addable);
        setEnvs(e);
        setVaults(v);
        setAgentId(addable[0]?.id ?? "");
      })
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [client, onTeam]);

  const agent = agents?.find((a) => a.id === agentId) ?? null;

  const allowedEnvs = useMemo(() => {
    if (!agent) return [];
    return envs.filter((e) => allowed(e.id, agent.allowed_environment_ids, agent.environment_id));
  }, [agent, envs]);
  const ownEnv = allowedEnvs.find((e) => e.id === agent?.environment_id) ?? null;
  const otherEnvs = allowedEnvs.filter((e) => e.id !== agent?.environment_id);
  const allowedVaults = useMemo(() => {
    if (!agent) return [];
    return vaults.filter((v) => allowed(v.id, agent.allowed_vault_ids, null));
  }, [agent, vaults]);

  useEffect(() => {
    if (envId && !otherEnvs.some((e) => e.id === envId)) setEnvId("");
    if (vaultId && !allowedVaults.some((v) => v.id === vaultId)) setVaultId("");
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!agentId) return;
    setBusy(true);
    setError(null);
    try {
      const t = await client.addTeammate({
        agent_id: agentId,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(envId ? { environment_id: envId } : {}),
        ...(vaultId ? { vault_id: vaultId } : {}),
      });
      onAdded(t.agent_id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted small">
        An agent you built in Fountain — with its skills, MCP servers and environment — as a teammate.{" "}
        <button type="button" className="linkish" onClick={onNew}>
          Or start from a name
        </button>
        .
      </p>
      {agents === null && !error && <div className="muted">Loading…</div>}
      {agents && agents.length === 0 && (
        <div className="muted">
          Every agent you have is already on the team.{" "}
          <a href={`${client.baseUrl}/agents/new`} target="_blank" rel="noreferrer">
            Create another in Fountain
          </a>
        </div>
      )}
      {agents && agents.length > 0 && (
        <form onSubmit={submit} className="stack">
          <label>
            Agent
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.runtime} · {a.model})
                </option>
              ))}
            </select>
          </label>
          <label>
            Name <span className="muted">(optional)</span>
            <input type="text" value={name} maxLength={120} placeholder={agent?.name ?? "Teammate"} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            <span className="hint">How they show up on the team. Blank uses the agent's name.</span>
          </label>
          {otherEnvs.length > 0 && (
            <label>
              Environment
              <select value={envId} onChange={(e) => setEnvId(e.target.value)}>
                <option value="">{ownEnv ? `Agent's default (${ownEnv.name})` : "Agent's default"}</option>
                {otherEnvs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <span className="hint">Their computer is set up from this environment instead of the agent's own.</span>
            </label>
          )}
          {allowedVaults.length > 0 && (
            <label>
              Vault <span className="muted">(optional)</span>
              <select value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
                <option value="">— none —</option>
                {allowedVaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <span className="hint">Layered on top of the environment's secrets. Vault values win on key collision.</span>
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <div className="row end">
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !agentId}>
              {busy ? "Adding…" : "Add to team"}
            </button>
          </div>
        </form>
      )}
      {agents === null && error && <div className="error">{error}</div>}
    </>
  );
}

function allowed(id: string, list: string[] | null, own: string | null): boolean {
  if (list === null) return true;
  if (id === own) return true;
  return list.includes(id);
}
