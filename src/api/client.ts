/**
 * The Fountain API, as much of it as the team app needs. Every call carries
 * the bearer key; every error is an `ApiError` with the server's `error`
 * string when there was one, so the UI can say "still working on the last
 * message" instead of "400".
 */
import type { Catalog } from "../lib/brain";
import type {
  Agent,
  Conversation,
  Environment,
  HistoryConversation,
  LogEvent,
  Runner,
  Me,
  Schedule,
  ScheduleInput,
  SearchHit,
  Teammate,
  TreeNode,
  Turn,
  Vault,
} from "./types";
import { readSse, type SseMessage } from "../lib/sse";
import type { Settings } from "../lib/settings";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export interface AddTeammateInput {
  agent_id: string;
  name?: string;
  environment_id?: string;
  vault_id?: string;
}

export class FountainClient {
  constructor(private settings: Settings) {}

  get baseUrl(): string {
    return this.settings.baseUrl;
  }

  // ── auth ────────────────────────────────────────────────────────────────

  me(): Promise<Me> {
    return this.json<Me>("GET", "/api/auth/me");
  }

  // ── team ────────────────────────────────────────────────────────────────

  async listTeam(): Promise<Teammate[]> {
    const r = await this.json<{ data: Teammate[] }>("GET", "/api/team");
    return r.data;
  }

  async getTeammate(agentId: string): Promise<Teammate> {
    const r = await this.json<{ data: Teammate }>("GET", `/api/team/${agentId}`);
    return r.data;
  }

  async addTeammate(input: AddTeammateInput): Promise<Teammate> {
    const r = await this.json<{ data: Teammate }>("POST", "/api/team", input);
    return r.data;
  }

  async renameTeammate(agentId: string, name: string | null): Promise<Teammate> {
    const r = await this.json<{ data: Teammate }>("PATCH", `/api/team/${agentId}`, { name });
    return r.data;
  }

  /** The teammate's conversations on the team, newest first, the live one flagged `current`. */
  async teammateHistory(agentId: string): Promise<HistoryConversation[]> {
    return (await this.json<{ data: HistoryConversation[] }>("GET", `/api/team/${agentId}/conversations`)).data;
  }

  /**
   * A fresh conversation on the teammate's current computer: the current one is retired (it
   * stays in History) and the new one takes over the sandbox — the next message starts a clean
   * runtime session on the same disk. 400 `conversation_busy` mid-turn, 503 `provisioning`
   * while the computer is starting; a gone computer is replaced by a new one.
   */
  async freshConversation(agentId: string): Promise<Teammate> {
    const r = await this.json<{ data: Teammate }>("POST", `/api/team/${agentId}/conversations`);
    return r.data;
  }

  // ── runners ─────────────────────────────────────────────────────────────

  async listRunners(): Promise<Runner[]> {
    return (await this.json<{ data: Runner[] }>("GET", "/api/runners")).data;
  }

  deleteRunner(id: string): Promise<void> {
    return this.json<void>("DELETE", `/api/runners/${id}`);
  }

  removeTeammate(agentId: string): Promise<void> {
    return this.json<void>("DELETE", `/api/team/${agentId}`);
  }

  sendMessage(
    agentId: string,
    prompt: string,
    images: Array<{ data: string; media_type: string }> = [],
  ): Promise<{ status: string; conversation_id: string }> {
    const body: Record<string, unknown> = { prompt };
    if (images.length) body.images = images.map((i) => ({ data: i.data, media_type: i.media_type }));
    return this.json("POST", `/api/team/${agentId}/messages`, body);
  }

  // ── schedules (routines) ────────────────────────────────────────────────

  async listSchedules(): Promise<Schedule[]> {
    return (await this.json<{ data: Schedule[] }>("GET", "/api/team/schedules")).data;
  }

  async createSchedule(agentId: string, input: ScheduleInput): Promise<Schedule> {
    return (await this.json<{ data: Schedule }>("POST", `/api/team/${agentId}/schedules`, input)).data;
  }

  async updateSchedule(agentId: string, id: string, input: Partial<ScheduleInput>): Promise<Schedule> {
    return (await this.json<{ data: Schedule }>("PATCH", `/api/team/${agentId}/schedules/${id}`, input)).data;
  }

  deleteSchedule(agentId: string, id: string): Promise<void> {
    return this.json<void>("DELETE", `/api/team/${agentId}/schedules/${id}`);
  }

  runSchedule(agentId: string, id: string): Promise<{ status: string; conversation_id: string }> {
    return this.json("POST", `/api/team/${agentId}/schedules/${id}/run`);
  }

  // ── search ──────────────────────────────────────────────────────────────

  async search(q: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchHit[]> {
    const qs = new URLSearchParams({ q, limit: String(opts.limit ?? 20) });
    return (await this.json<{ data: SearchHit[] }>("GET", `/api/search?${qs}`, undefined, opts.signal)).data;
  }

  // ── conversations (the thread) ──────────────────────────────────────────

  async tree(conversationId: string): Promise<TreeNode[]> {
    return (await this.json<{ data: TreeNode[] }>("GET", `/api/conversations/${conversationId}/tree`)).data;
  }

  getAgent(agentId: string): Promise<Agent> {
    return this.json<{ data: Agent }>("GET", `/api/agents/${agentId}`).then((r) => r.data);
  }

  async listTurns(conversationId: string): Promise<Turn[]> {
    const r = await this.json<{ data: Turn[] }>("GET", `/api/conversations/${conversationId}/turns`);
    return r.data;
  }

  /** Every event of the conversation on the given streams, oldest first, paging until drained. */
  async listAllEvents(conversationId: string, streams: string[]): Promise<LogEvent[]> {
    const out: LogEvent[] = [];
    let after: number | null = null;
    for (;;) {
      const qs = new URLSearchParams({ limit: "1000", streams: streams.join(",") });
      if (after !== null) qs.set("after", String(after));
      const page: { data: LogEvent[]; meta: { has_more: boolean; next_cursor: number | null } } =
        await this.json("GET", `/api/conversations/${conversationId}/events?${qs}`);
      out.push(...page.data);
      if (!page.meta.has_more || page.meta.next_cursor === null) break;
      after = page.meta.next_cursor;
    }
    return out;
  }

  /** The bytes of one image attached to a turn, as an object URL (revoke it when done). */
  async turnImageUrl(conversationId: string, turnId: string, position: number): Promise<string> {
    const res = await this.fetchRaw(`/api/conversations/${conversationId}/turns/${turnId}/images/${position}`);
    if (!res.ok) throw new ApiError(res.status, null, `image ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }

  markRead(conversationId: string): Promise<void> {
    return this.json<void>("POST", `/api/conversations/${conversationId}/read`);
  }

  /** End the conversation and its computer; the teammate's next message opens a fresh one on a new computer and this one joins its history. (`freshConversation` keeps the computer.) */
  terminate(conversationId: string): Promise<unknown> {
    return this.json("POST", `/api/conversations/${conversationId}/terminate`);
  }

  interrupt(conversationId: string): Promise<unknown> {
    return this.json("POST", `/api/conversations/${conversationId}/interrupt`);
  }

  getConversation(conversationId: string): Promise<Conversation> {
    return this.json<{ data: Conversation }>("GET", `/api/conversations/${conversationId}`).then((r) => r.data);
  }

  // ── creating a teammate from scratch ────────────────────────────────────

  getCatalog(): Promise<Catalog> {
    return this.json<{ data: Catalog }>("GET", "/api/catalog").then((r) => r.data);
  }

  /** per-provider set/not-set, e.g. {anthropic_api_key: true} */
  async inferenceCredentials(): Promise<Record<string, boolean>> {
    const r = await this.json<{ data: unknown }>("GET", "/api/account/inference-credentials");
    const d = r.data as Record<string, unknown> | Array<Record<string, unknown>>;
    const out: Record<string, boolean> = {};
    if (Array.isArray(d)) {
      for (const row of d) {
        const k = typeof row.provider === "string" ? row.provider : typeof row.name === "string" ? row.name : null;
        if (k) out[k] = row.set === true || row.configured === true || row.present === true;
      }
    } else if (d && typeof d === "object") {
      for (const [k, v] of Object.entries(d)) {
        out[k] = v === true || (typeof v === "object" && v !== null && ((v as Record<string, unknown>).set === true || (v as Record<string, unknown>).configured === true));
      }
    }
    return out;
  }

  createAgent(input: {
    name: string;
    model: string;
    runtime: string;
    description?: string;
    system?: string;
    environment_id?: string | null;
  }): Promise<Agent> {
    return this.json<{ data: Agent }>("POST", "/api/agents", input).then((r) => r.data);
  }

  updateAgent(agentId: string, input: Partial<{ name: string; model: string; runtime: string; description: string; system: string }>): Promise<Agent> {
    return this.json<{ data: Agent }>("PUT", `/api/agents/${agentId}`, input).then((r) => r.data);
  }

  generateAvatar(base: string, mood: string): Promise<{ data: string; media_type: string }> {
    return this.json<{ data: { data: string; media_type: string } }>("POST", "/api/avatars/generate", { base, mood }).then((r) => r.data);
  }

  putAvatar(agentId: string, data: string, media_type: string): Promise<unknown> {
    return this.json("PUT", `/api/agents/${agentId}/avatar`, { data, media_type });
  }

  // ── picker options ──────────────────────────────────────────────────────

  async listAgents(): Promise<Agent[]> {
    return (await this.json<{ data: Agent[] }>("GET", "/api/agents")).data;
  }

  async listEnvironments(): Promise<Environment[]> {
    return (await this.json<{ data: Environment[] }>("GET", "/api/environments")).data;
  }

  async listVaults(): Promise<Vault[]> {
    return (await this.json<{ data: Vault[] }>("GET", "/api/vaults")).data;
  }

  // ── stream ──────────────────────────────────────────────────────────────

  /**
   * The whole team's events on one connection. Resolves when the server
   * closes (idle timeout, deploy); the caller reconnects with the last id.
   */
  streamTeam(opts: {
    lastEventId: string | null;
    streams: string[];
    signal: AbortSignal;
    onMessage: (msg: SseMessage) => void;
    onOpen?: () => void;
    onClose: (err?: unknown) => void;
  }): Promise<void> {
    const qs = new URLSearchParams({ streams: opts.streams.join(",") });
    return readSse(`${this.baseUrl}/api/team/stream?${qs}`, {
      headers: { authorization: `Bearer ${this.settings.apiKey}` },
      lastEventId: opts.lastEventId,
      signal: opts.signal,
      onMessage: opts.onMessage,
      onOpen: opts.onOpen,
      onClose: opts.onClose,
    });
  }

  /** A raw authenticated GET, for bytes (avatars, images) rather than JSON. */
  fetchRaw(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.settings.apiKey}` },
    });
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private async json<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.settings.apiKey}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      const obj = (parsed ?? {}) as { error?: unknown; message?: unknown };
      const code = typeof obj.error === "string" ? obj.error : null;
      const message =
        typeof obj.message === "string" ? obj.message : code ?? `${res.status} ${res.statusText}`;
      const ra = res.headers.get("retry-after");
      throw new ApiError(res.status, code, message, ra ? Number(ra) : null);
    }
    return parsed as T;
  }
}

/** A human line for an API failure, in the app's voice. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "conversation_busy":
        return "They're still working on the last message.";
      case "provisioning":
        return "Their computer is still starting — try again shortly.";
      case "runner_offline":
        return "Their machine is offline — the message waits until the runner reconnects.";
      case "no_runner_online":
        return "None of your runners is online — start `fountain runner` on the machine first.";
      case "subscription_required":
        return "An active Fountain subscription is required.";
      case "environment_not_allowed":
        return "That agent may not use that environment.";
      case "vault_not_allowed":
        return "That agent may not use that vault.";
      case "environment_not_found":
        return "Environment not found.";
      case "vault_not_found":
        return "Vault not found.";
      case "not_found":
        return "Not found.";
      default:
        if (err.status === 401) return "That API key was not accepted.";
        if (err.status === 429) return "Too many requests — slow down a little.";
        if (err.status === 503) return "Fountain could not reach the sandbox provider — try again shortly.";
        return err.message;
    }
  }
  if (err instanceof TypeError) {
    return "Could not reach Fountain. Check the URL, and that API_CORS_ORIGINS on the server includes this site.";
  }
  return err instanceof Error ? err.message : String(err);
}
