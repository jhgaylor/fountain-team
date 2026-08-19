/**
 * The activity feed's shape (after Buzz's agent activity panel): the agent's
 * narration as prose, and the tool calls between narration folded into one
 * collapsible "Ran N tool calls" row — a single call shows as "Ran <what>"
 * with its duration. Pure: takes the turn's blocks, returns feed items.
 */
import type { Block } from "./acp";

export type ToolBlock = Extract<Block, { kind: "tool" }>;

export type FeedItem =
  | { kind: "text"; body: string }
  | { kind: "thinking"; body: string }
  | { kind: "tools"; tools: ToolBlock[] }
  | { kind: "raw"; body: string };

export function groupBlocks(blocks: Block[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const b of blocks) {
    if (b.kind === "tool") {
      const last = out[out.length - 1];
      if (last && last.kind === "tools") last.tools.push(b);
      else out.push({ kind: "tools", tools: [b] });
    } else if (b.kind === "text") {
      if (!b.body.trim()) continue;
      out.push({ kind: "text", body: b.body });
    } else if (b.kind === "thinking") {
      if (!b.body.trim()) continue;
      out.push({ kind: "thinking", body: b.body });
    } else {
      out.push({ kind: "raw", body: b.body });
    }
  }
  return out;
}

/** "Ran 5 tool calls", "Ran Edit lib/x.ex", "Running 2 tool calls…" */
export function toolsLabel(tools: ToolBlock[]): { verb: string; what: string; running: boolean } {
  const running = tools.some((t) => t.status === "running");
  const verb = running ? "Running" : "Ran";
  if (tools.length === 1) {
    const t = tools[0]!;
    const what = [t.name, t.summary].filter(Boolean).join(" ");
    return { verb, what: what || "a tool", running };
  }
  return { verb, what: `${tools.length} tool calls`, running };
}

/** Seconds between two ISO timestamps as "0.4s" / "12s" / "2m 05s"; null when unknown. */
export function duration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s - m * 60)).padStart(2, "0")}s`;
}

/** "just now", "2m ago", "3h ago", else a short date. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
