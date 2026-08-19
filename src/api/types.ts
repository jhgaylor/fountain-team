// Shapes as served by the Fountain API (see docs/api.md, "Team").

export interface Sandbox {
  id: string;
  sprite_name: string;
  status: string;
  url: string | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  usage_total?: Usage | null;
  sandbox_id: string | null;
  sandbox: Sandbox | null;
  agent_id: string | null;
  vault_id: string | null;
  environment_id: string | null;
  runtime: string;
  acp: boolean;
  status: "pending" | "running" | "idle" | "failed" | "terminated";
  channel_id: string | null;
  turn_count: number;
  last_active_at: string | null;
  last_read_at: string | null;
  unread: boolean;
  inserted_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  model: string;
  runtime: string;
  environment_id: string | null;
  allowed_vault_ids: string[] | null;
  allowed_environment_ids: string[] | null;
  avatar_media_type?: string | null;
  /** present on GET /api/agents/:id */
  system?: string | null;
  skills?: unknown[] | null;
  mcp_servers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  sandbox_provider?: string | null;
}

export interface Environment {
  id: string;
  name: string;
}

export interface Vault {
  id: string;
  name: string;
}

export type PresenceState =
  | "working"
  | "starting"
  | "online"
  | "asleep"
  | "away"
  | "failed"
  | "offline";

export interface Preview {
  kind: "you" | "them" | "typing";
  text: string | null;
}

export interface Teammate {
  agent_id: string;
  name: string;
  agent: Agent;
  conversation: Conversation;
  presence: { state: PresenceState; label: string };
  unread: boolean;
  last_turn: {
    id: string;
    turn_number: number;
    prompt: string;
    status: string;
    inserted_at: string;
  } | null;
  preview: Preview | null;
  /** summed over every conversation the agent has had on the team */
  usage_total?: Usage | null;
}

export interface Usage {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface Turn {
  id: string;
  turn_number: number;
  prompt: string;
  status: string;
  exit_code: number | null;
  started_at: string | null;
  ended_at: string | null;
  inserted_at: string;
  image_count: number;
  /** what the runtime reported when the turn ended; null in flight or unreported */
  usage?: Usage | null;
}

export interface Schedule {
  id: string;
  agent_id: string;
  name: string | null;
  cron: string;
  prompt: string;
  one_off: boolean;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_conversation_id: string | null;
  last_error: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface ScheduleInput {
  cron: string;
  prompt: string;
  name?: string | null;
  one_off?: boolean;
  enabled?: boolean;
}

export interface SearchHit {
  kind: "title" | "prompt" | "reply";
  conversation_id: string;
  agent_id: string | null;
  turn_id: string | null;
  turn_number: number | null;
  snippet: string;
  ts: string;
}

export interface TreeNode {
  id: string;
  status: string;
  source: string;
  parent_id: string | null;
  title?: string | null;
  agent_id?: string | null;
}

export interface LogEvent {
  id: number;
  kind: "output" | "stage" | string;
  stream: string | null;
  data: string | null;
  stage: string | null;
  state: string | null;
  duration_ms?: number | null;
  turn_id: string | null;
  ts: string;
}

/** A team-stream event: the log event plus the ids to route it. */
export interface TeamEvent extends LogEvent {
  conversation_id: string;
  agent_id: string | null;
}

export interface Me {
  id: string;
  email: string;
  role: string;
}
