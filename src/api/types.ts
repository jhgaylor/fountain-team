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
