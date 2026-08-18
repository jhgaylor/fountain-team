/**
 * Turn stored log events into what a chat bubble shows.
 *
 * The `acp` stream holds the raw Agent Client Protocol ndjson the adapter
 * emitted — one `session/update` notification per line. This is a port of
 * `Fountain.Runtimes.ACP.Blocks` (server side, tested there): text chunks
 * concatenate into the assistant's reply, tool calls become chips paired to
 * their result on `toolCallId`, everything else is dropped on purpose.
 *
 * Non-ACP runtimes (legacy stdout) are shown as plain text lines — good
 * enough for a preview; the full conversation view in Fountain does better.
 */
import type { LogEvent } from "../api/types";

export type Block =
  | { kind: "text"; body: string }
  | { kind: "thinking"; body: string }
  | { kind: "tool"; id: string | null; name: string; summary: string; status: "running" | "done" | "error"; output: string }
  | { kind: "raw"; body: string };

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** Blocks for one turn's events, adjacent text merged, tools paired. */
export function blocksForTurn(events: LogEvent[], runtime: string): Block[] {
  const out: Block[] = [];
  const tools = new Map<string, Extract<Block, { kind: "tool" }>>();

  const pushText = (kind: "text" | "thinking", body: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.body += body;
    else out.push({ kind, body });
  };

  for (const ev of events) {
    if (ev.kind !== "output" || typeof ev.data !== "string") continue;
    if (ev.stream === "acp") {
      for (const line of ev.data.split("\n")) {
        if (!line.trim()) continue;
        const update = updateOf(line);
        if (!update) {
          if (!looksLikeJsonRpc(line)) out.push({ kind: "raw", body: line });
          continue;
        }
        switch (update.sessionUpdate) {
          case "agent_message_chunk": {
            const t = contentText(update.content);
            if (t) pushText("text", t);
            break;
          }
          case "agent_thought_chunk": {
            const t = contentText(update.content);
            if (t) pushText("thinking", t);
            break;
          }
          case "tool_call": {
            const id = str(update.toolCallId);
            const block: Extract<Block, { kind: "tool" }> = {
              kind: "tool",
              id,
              name: toolName(update),
              summary: toolSummary(update),
              status: "running",
              output: "",
            };
            out.push(block);
            if (id) tools.set(id, block);
            break;
          }
          case "tool_call_update": {
            const status = str(update.status);
            if (!status || !TERMINAL.has(status)) break;
            const id = str(update.toolCallId);
            const block = id ? tools.get(id) : undefined;
            if (block) {
              block.status = status === "completed" ? "done" : "error";
              block.output = toolOutput(update);
            }
            break;
          }
          default:
            break;
        }
      }
    } else if (ev.stream === "stdout" && runtime !== "claude" && runtime !== "codex" && runtime !== "opencode") {
      // Legacy dialects: show the text as-is rather than parse four vendor
      // formats here. Claude/codex/opencode only ever spoke ACP on this page.
      pushText("text", ev.data);
    }
  }
  return out;
}

/** The concatenated assistant text of a turn — the roster preview and the bubble. */
export function assistantText(events: LogEvent[], runtime: string): string {
  return blocksForTurn(events, runtime)
    .filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text")
    .map((b) => b.body)
    .join("")
    .trim();
}

type Json = Record<string, unknown>;

function updateOf(line: string): Json | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(msg) || msg.method !== "session/update") return null;
  const params = msg.params;
  if (!isObj(params)) return null;
  const update = params.update;
  return isObj(update) ? update : params;
}

function looksLikeJsonRpc(line: string): boolean {
  try {
    const v = JSON.parse(line);
    return isObj(v) && v.jsonrpc === "2.0";
  } catch {
    return false;
  }
}

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function contentText(content: unknown): string {
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join("");
  if (typeof content === "string") return content;
  if (!isObj(content)) return "";
  switch (content.type) {
    case "text":
      return typeof content.text === "string" ? content.text : "";
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    case "resource_link":
      return typeof content.uri === "string" ? content.uri : "";
    default:
      return "";
  }
}

function toolName(u: Json): string {
  const title = str(u.title);
  if (title) return title;
  const kind = str(u.kind);
  return kind || "tool";
}

function toolSummary(u: Json): string {
  const locs = u.locations;
  if (Array.isArray(locs) && locs.length > 0) {
    const first = locs[0];
    if (isObj(first) && typeof first.path === "string") return first.path;
  }
  const input = u.rawInput;
  if (isObj(input) && Object.keys(input).length > 0) {
    return truncate(
      Object.entries(input)
        .map(([k, v]) => `${k}=${truncate(typeof v === "string" ? v : JSON.stringify(v), 40)}`)
        .join(" "),
      120,
    );
  }
  return "";
}

function toolOutput(u: Json): string {
  const content = u.content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (isObj(c) && c.type === "content") return contentText(c.content);
        if (isObj(c) && c.type === "diff") return `diff: ${str(c.path) ?? ""}`;
        return contentText(c);
      })
      .join("\n");
  }
  const raw = u.rawOutput;
  if (raw == null) return "";
  return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
