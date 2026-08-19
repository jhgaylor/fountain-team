import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { LogEvent, Teammate, TreeNode, Turn } from "../api/types";
import type { FountainClient } from "../api/client";
import { blocksForTurn, type Block } from "../lib/acp";
import { loadDraft, saveDraft } from "../lib/drafts";
import { formatUsage } from "../lib/format";
import { imageFilesFrom, readImage, releaseImages, type OutgoingImage } from "../lib/images";
import type { QueuedMessage } from "../lib/queue";
import { isNearBottom, TURN_WINDOW, windowTail } from "../lib/scroll";
import { formatTime } from "./Roster";

interface Props {
  client: FountainClient;
  teammate: Teammate;
  turns: Turn[];
  events: LogEvent[];
  queued: readonly QueuedMessage[];
  loading: boolean;
  /** Resolves "sent" or "queued" (the teammate was busy: it waits for the turn to end). */
  onSend: (text: string, images: OutgoingImage[]) => Promise<"sent" | "queued">;
  onCancelQueued: (id: string) => void;
  onInterrupt: () => void;
  onRemove: () => void;
  onBack: () => void;
  onError: (text: string) => void;
  onRoutines: () => void;
  /** a turn to scroll to and highlight (from search); cleared by the parent once consumed */
  focusTurnId: string | null;
  onFocused: () => void;
  fountainUrl: string;
}

export function Thread({
  client,
  teammate,
  turns,
  events,
  queued,
  loading,
  onSend,
  onCancelQueued,
  onInterrupt,
  onRemove,
  onBack,
  onError,
  onRoutines,
  focusTurnId,
  onFocused,
  fountainUrl,
}: Props) {
  const conv = teammate.conversation;
  const busy = teammate.presence.state === "working" || teammate.presence.state === "starting" || conv.status === "running";
  const [draft, setDraft] = useState(() => loadDraft(conv.id));
  const [images, setImages] = useState<OutgoingImage[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [visible, setVisible] = useState(TURN_WINDOW);
  const [following, setFollowing] = useState(true);
  const [pendingBelow, setPendingBelow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const growRef = useRef<{ from: number; top: number } | null>(null);

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

  const { shown, hidden } = useMemo(() => windowTail(turns, visible), [turns, visible]);

  // ── scrolling: follow the bottom until the reader scrolls up ─────────────

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
    setPendingBelow(false);
  }, []);

  // A new conversation: fresh window, jump to the bottom.
  useLayoutEffect(() => {
    setVisible(TURN_WINDOW);
    setFollowing(true);
    setPendingBelow(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv.id]);

  // New content: stick to the bottom only if we were there.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (growRef.current) {
      // "Show earlier" grew the top: keep what the reader was looking at in place.
      el.scrollTop = el.scrollHeight - growRef.current.from + growRef.current.top;
      growRef.current = null;
      return;
    }
    if (following) el.scrollTop = el.scrollHeight;
    else setPendingBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length, turns.length, queued.length, loading]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    setFollowing(near);
    if (near) setPendingBelow(false);
  };

  // Jump to a turn (from search): widen the window until it renders, then
  // scroll it into view and highlight it for a moment.
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!focusTurnId) return;
    const idx = turns.findIndex((t) => t.id === focusTurnId);
    if (idx === -1) return; // not (yet) in this conversation's turns
    const needed = turns.length - idx;
    if (needed > visible) {
      setVisible(Math.ceil(needed / TURN_WINDOW) * TURN_WINDOW);
      return; // re-run once the window grew
    }
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-turn-id="${focusTurnId}"]`);
    if (!el) return;
    setFollowing(false);
    el.scrollIntoView({ block: "center" });
    setHighlight(focusTurnId);
    // not cleaned up on purpose: onFocused() clears focusTurnId, which would
    // cancel the timeout before it ran and leave the highlight on
    window.setTimeout(() => setHighlight((h) => (h === focusTurnId ? null : h)), 2500);
    onFocused();
  }, [focusTurnId, turns, visible, onFocused]);

  // The spawn tree: what this teammate started (sub-conversations over the API).
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    client
      .tree(conv.id)
      .then((nodes) => !cancelled && setTree(nodes))
      .catch(() => !cancelled && setTree([]));
    return () => {
      cancelled = true;
    };
    // re-read whenever a turn ends (turns.length changes on start; status on end)
  }, [client, conv.id, turns.length, conv.status]);
  const spawned = tree.filter((n) => n.id !== conv.id);

  const showEarlier = () => {
    const el = scrollRef.current;
    if (el) growRef.current = { from: el.scrollHeight, top: el.scrollTop };
    setVisible((v) => v + TURN_WINDOW);
  };

  // ── drafts ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setDraft(loadDraft(conv.id));
    setImages((imgs) => {
      releaseImages(imgs);
      return [];
    });
    textRef.current?.focus();
  }, [conv.id]);

  const changeDraft = (text: string) => {
    setDraft(text);
    saveDraft(conv.id, text);
  };

  // ── attachments ──────────────────────────────────────────────────────────

  const attach = useCallback(
    async (files: File[]) => {
      for (const f of files) {
        try {
          const img = await readImage(f);
          setImages((imgs) => [...imgs, img]);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [onError],
  );

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFrom(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    void attach(imageFilesFrom(e.dataTransfer));
  };

  const removeImage = (i: number) => {
    setImages((imgs) => {
      releaseImages([imgs[i]!]);
      return imgs.filter((_, j) => j !== i);
    });
  };

  // ── sending ──────────────────────────────────────────────────────────────

  async function send() {
    const text = draft.trim();
    if ((!text && images.length === 0) || sending) return;
    setSending(true);
    try {
      await onSend(text, images);
      changeDraft("");
      setImages([]); // previews live on in the queued bubble or are released by App
    } catch {
      /* App already showed the error; keep the draft */
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

  const canSend = !sending && (draft.trim().length > 0 || images.length > 0);

  return (
    <section
      className={`thread ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        if (imageFilesFrom(e.dataTransfer).length || e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
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
            {formatUsage(teammate.usage_total) && (
              <span className="muted" title="Tokens over every conversation this teammate has had on the team">
                {" "}
                · {formatUsage(teammate.usage_total)}
              </span>
            )}
          </div>
        </div>
        <div className="row">
          {spawned.length > 0 && (
            <button className="secondary small" onClick={() => setTreeOpen((o) => !o)} title="Conversations this teammate started" aria-expanded={treeOpen}>
              Spawned · {spawned.length}
            </button>
          )}
          <button className="secondary small" onClick={onRoutines} title="Schedules that run this teammate">
            Routines
          </button>
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

      {treeOpen && spawned.length > 0 && (
        <div className="spawned">
          <div className="spawned-head small muted">Started by {teammate.name} — sub-conversations in this thread's spawn tree</div>
          <ul>
            {spawned.map((n) => (
              <li key={n.id}>
                <span className={`presence inline ${n.status === "running" ? "working" : n.status === "failed" ? "failed" : "online"}`} />
                <a href={`${fountainUrl}/conversations/${n.id}`} target="_blank" rel="noreferrer">
                  {n.title || n.id.slice(0, 8)}
                </a>
                <span className="muted small">
                  {" "}
                  · {n.status}
                  {n.parent_id && n.parent_id !== conv.id ? " · nested" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="messages-wrap">
        <div className="messages" ref={scrollRef} onScroll={onScroll}>
          {loading && <div className="centered muted">Loading…</div>}
          {!loading && hidden > 0 && (
            <button className="secondary small show-earlier" onClick={showEarlier}>
              Show earlier messages ({hidden} more)
            </button>
          )}
          {!loading && turns.length === 0 && queued.length === 0 && (
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
          {shown.map((turn) => (
            <TurnView
              key={turn.id}
              client={client}
              conversationId={conv.id}
              turn={turn}
              events={eventsByTurn.get(turn.id) ?? []}
              runtime={conv.runtime}
              highlighted={highlight === turn.id}
            />
          ))}
          {queued.map((q) => (
            <QueuedView key={q.id} message={q} onCancel={() => onCancelQueued(q.id)} />
          ))}
        </div>
        {pendingBelow && !following && (
          <button className="jump-down" onClick={scrollToBottom}>
            New messages ↓
          </button>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {images.length > 0 && (
          <div className="attachments">
            {images.map((img, i) => (
              <div className="attachment" key={img.previewUrl}>
                <img src={img.previewUrl} alt={img.name} title={img.name} />
                <button type="button" className="remove" onClick={() => removeImage(i)} aria-label={`Remove ${img.name}`}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            type="button"
            className="icon attach"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach an image"
            title="Attach an image (or paste / drop one)"
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void attach(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <textarea
            ref={textRef}
            rows={1}
            value={draft}
            placeholder={busy ? `Message ${teammate.name}… (queued until they're done)` : `Message ${teammate.name}…`}
            onChange={(e) => changeDraft(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
          />
          <button
            type="submit"
            className={`send ${busy ? "queue" : ""}`}
            disabled={!canSend}
            aria-label={busy ? "Queue" : "Send"}
            title={busy ? "They're busy — this is sent when the turn ends (Enter)" : "Send (Enter · Shift+Enter for a new line)"}
          >
            {busy ? "⏱" : "↑"}
          </button>
        </div>
      </form>
    </section>
  );
}

function QueuedView({ message, onCancel }: { message: QueuedMessage; onCancel: () => void }) {
  return (
    <div className="turn">
      <div className="bubble you queued">
        {message.images.length > 0 && (
          <div className="bubble-images">
            {message.images.map((img) => (
              <img key={img.previewUrl} src={img.previewUrl} alt={img.name} />
            ))}
          </div>
        )}
        {message.text && <div className="body">{message.text}</div>}
        <div className="meta">
          queued · sent when they're done ·{" "}
          <button type="button" className="link" onClick={onCancel}>
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TurnView({
  client,
  conversationId,
  turn,
  events,
  runtime,
  highlighted,
}: {
  client: FountainClient;
  conversationId: string;
  turn: Turn;
  events: LogEvent[];
  runtime: string;
  highlighted: boolean;
}) {
  const blocks = useMemo(() => blocksForTurn(events, runtime), [events, runtime]);
  const inFlight = turn.status === "pending" || turn.status === "running";
  const failed = turn.status === "failed" || turn.status === "cancelled";
  const usage = formatUsage(turn.usage);
  return (
    <div className={`turn ${highlighted ? "highlight" : ""}`} data-turn-id={turn.id}>
      <div className="bubble you">
        {turn.image_count > 0 && <TurnImages client={client} conversationId={conversationId} turn={turn} />}
        {turn.prompt && <div className="body">{turn.prompt}</div>}
        <div className="meta">{formatTime(turn.inserted_at)}</div>
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
      {!inFlight && usage && (
        <div className="muted small typing-note usage" title="Tokens the runtime reported for this turn">
          {usage}
        </div>
      )}
    </div>
  );
}

/** The images the API stored with a turn, fetched with the bearer key. */
function TurnImages({ client, conversationId, turn }: { client: FountainClient; conversationId: string; turn: Turn }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    Promise.all(
      Array.from({ length: turn.image_count }, (_, i) =>
        client
          .turnImageUrl(conversationId, turn.id, i)
          .then((u) => {
            made.push(u);
            return u;
          })
          .catch(() => null),
      ),
    ).then((us) => {
      if (!cancelled) setUrls(us.filter((u): u is string => u !== null));
    });
    return () => {
      cancelled = true;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [client, conversationId, turn.id, turn.image_count]);
  if (!urls.length) return <div className="meta">{turn.image_count} image{turn.image_count === 1 ? "" : "s"}</div>;
  return (
    <div className="bubble-images">
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          <img src={u} alt="" />
        </a>
      ))}
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
