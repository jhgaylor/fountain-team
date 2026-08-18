import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { LogEvent, Teammate, Turn } from "../api/types";
import { blocksForTurn, type Block } from "../lib/acp";
import { formatTime } from "./Roster";

interface Props {
  teammate: Teammate;
  turns: Turn[];
  events: LogEvent[];
  loading: boolean;
  onSend: (text: string) => Promise<void>;
  onInterrupt: () => void;
  onRemove: () => void;
  onBack: () => void;
  fountainUrl: string;
}

export function Thread({ teammate, turns, events, loading, onSend, onInterrupt, onRemove, onBack, fountainUrl }: Props) {
  const conv = teammate.conversation;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const eventsByTurn = useMemo(() => {
    const m = new Map<string, LogEvent[]>();
    for (const ev of events) {
      if (!ev.turn_id) continue;
      const arr = m.get(ev.turn_id);
      if (arr) arr.push(ev);
      else m.set(ev.turn_id, [ev]);
    }
    return m;
  }, [events]);

  // Stick to the bottom as the reply streams, the way a chat should.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, turns.length, teammate.agent_id]);

  useEffect(() => {
    setDraft("");
    textRef.current?.focus();
  }, [conv.id]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
    } finally {
      setSending(false);
      textRef.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className="thread">
      <header className="thread-header">
        <button className="back" onClick={onBack} aria-label="Back to the team">
          ‹ Team
        </button>
        <div className="thread-title">
          <div className="name">{teammate.name}</div>
          <div className="sub">
            {teammate.name !== teammate.agent.name && <span>{teammate.agent.name} · </span>}
            <span className={`presence inline ${teammate.presence.state}`} />
            <span>{teammate.presence.label}</span>
            {conv.sandbox && <span className="mono muted"> · {conv.sandbox.sprite_name}</span>}
          </div>
        </div>
        <div className="row">
          {conv.status === "running" && (
            <button className="secondary small" onClick={onInterrupt}>
              Interrupt
            </button>
          )}
          <a
            className="button secondary small"
            href={`${fountainUrl}/conversations/${conv.id}`}
            target="_blank"
            rel="noreferrer"
            title="The full conversation view in Fountain: stages, tool calls, raw output"
          >
            Details
          </a>
          <button className="danger small" onClick={onRemove}>
            Remove
          </button>
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        {loading && <div className="centered muted">Loading…</div>}
        {!loading && turns.length === 0 && (
          <div className="centered muted empty-thread">
            <div className="glyph">💬</div>
            {conv.status === "pending" ? (
              <div>
                Starting <b>{teammate.name}</b>'s computer…
              </div>
            ) : conv.status === "failed" ? (
              <div>
                <b>{teammate.name}</b>'s computer failed to start — a message tries a new one.
              </div>
            ) : (
              <div>
                Say hello to <b>{teammate.name}</b>.
              </div>
            )}
            <div className="small">
              {teammate.agent.runtime} · {teammate.agent.model}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} events={eventsByTurn.get(turn.id) ?? []} runtime={conv.runtime} />
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          placeholder={`Message ${teammate.name}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="send" disabled={sending || !draft.trim()} aria-label="Send" title="Send (Enter · Shift+Enter for a new line)">
          ↑
        </button>
      </form>
    </section>
  );
}

function TurnView({ turn, events, runtime }: { turn: Turn; events: LogEvent[]; runtime: string }) {
  const blocks = useMemo(() => blocksForTurn(events, runtime), [events, runtime]);
  const inFlight = turn.status === "pending" || turn.status === "running";
  const failed = turn.status === "failed" || turn.status === "cancelled";
  return (
    <div className="turn">
      <div className="bubble you">
        <div className="body">{turn.prompt}</div>
        <div className="meta">
          {formatTime(turn.inserted_at)}
          {turn.image_count > 0 && ` · ${turn.image_count} image${turn.image_count === 1 ? "" : "s"}`}
        </div>
      </div>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
      {inFlight && blocks.length === 0 && (
        <div className="bubble them typing">
          <span />
          <span />
          <span />
        </div>
      )}
      {inFlight && blocks.length > 0 && <div className="muted small typing-note">typing…</div>}
      {failed && <div className="muted small typing-note">turn {turn.status}</div>}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "text":
      return (
        <div className="bubble them">
          <div className="body">{block.body}</div>
        </div>
      );
    case "thinking":
      return (
        <details className="thinking">
          <summary>thinking</summary>
          <div className="body">{block.body}</div>
        </details>
      );
    case "tool":
      return (
        <details className={`tool ${block.status}`}>
          <summary>
            <span className="tool-name">{block.name}</span>
            {block.summary && <span className="tool-summary">{block.summary}</span>}
            <span className="tool-status">{block.status === "running" ? "…" : block.status === "done" ? "✓" : "✕"}</span>
          </summary>
          {block.output && <pre>{block.output}</pre>}
        </details>
      );
    case "raw":
      return <pre className="raw">{block.body}</pre>;
  }
}
