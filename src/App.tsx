import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, FountainClient, describeError } from "./api/client";
import type { LogEvent, Schedule, SearchHit, TeamEvent, Teammate, Turn } from "./api/types";
import { clearSettings, loadSettings, saveSettings, type Settings } from "./lib/settings";
import { SettingsScreen } from "./components/Settings";
import { completeLoginIfCallback, revoke } from "./lib/oauth";
import { Roster, type RowAction } from "./components/Roster";
import { Thread } from "./components/Thread";
import { AddDialog } from "./components/AddDialog";
import { addInstantTeammate } from "./lib/instant";
import { Routines } from "./components/Routines";
import { Palette, type PaletteChoice } from "./components/Palette";
import { teamManifest } from "./lib/manifest";
import { Onboarding } from "./components/Onboarding";
import { Shortcuts } from "./components/Shortcuts";
import { History } from "./components/History";
import { Runners } from "./components/Runners";
import { releaseImages, type OutgoingImage } from "./lib/images";
import { notifyPermission, requestNotifyPermission, shouldNotify, showReplyNotification, type NotifyPermission } from "./lib/notify";
import { loadPrefs, savePrefs, sortPinnedFirst, toggleIn, without, type Prefs } from "./lib/prefs";
import { drain, enqueue, newQueuedId, removeQueued, withoutConversation, type QueuedMessage } from "./lib/queue";

const THREAD_STREAMS = ["acp", "stdout", "stage"];

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(() => loadSettings());
  const [editingSettings, setEditingSettings] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(() => /[?&](code|error)=/.test(window.location.search));
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Finish an in-progress "Sign in with Fountain" before rendering anything.
  useEffect(() => {
    completeLoginIfCallback()
      .then(async (result) => {
        if (!result) return;
        const s: Settings = { baseUrl: result.baseUrl, apiKey: result.apiKey, via: "oauth" };
        try {
          const me = await new FountainClient(s).me();
          saveSettings(s);
          setSettings(s);
          setEmail(me.email);
        } catch {
          setOauthError("Signed in, but that Fountain could not be reached.");
        }
      })
      .catch((err) => setOauthError(err instanceof Error ? err.message : String(err)))
      .finally(() => setOauthBusy(false));
  }, []);

  if (oauthBusy) {
    return (
      <div className="settings">
        <div className="settings-card">
          <h1>Signing in…</h1>
        </div>
      </div>
    );
  }

  if (!settings || editingSettings) {
    return (
      <SettingsScreen
        initial={settings}
        error={oauthError}
        onCancel={settings ? () => setEditingSettings(false) : undefined}
        onConnected={(s, who) => {
          saveSettings(s);
          setSettings(s);
          setEmail(who);
          setEditingSettings(false);
          setOauthError(null);
        }}
      />
    );
  }
  return (
    <Team
      key={settings.baseUrl + settings.apiKey}
      settings={settings}
      email={email}
      onSettings={() => setEditingSettings(true)}
      onSignOut={() => {
        if (settings.via === "oauth") void revoke(settings.baseUrl, settings.apiKey);
        clearSettings();
        setSettings(null);
      }}
    />
  );
}

function Team({ settings, onSettings, onSignOut }: { settings: Settings; email: string | null; onSettings: () => void; onSignOut: () => void }) {
  const client = useMemo(() => new FountainClient(settings), [settings]);
  const [team, setTeam] = useState<Teammate[]>([]);
  // false until the first roster fetch settles: nothing that means "empty"
  // may render before we know, or every refresh flashes the onboarding card
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => idFromHash());
  const [page, setPage] = useState<"team" | "routines" | "runners">(() => pageFromHash());
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [teamVersion, setTeamVersion] = useState(0);
  const [routinesFor, setRoutinesFor] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusTurnId, setFocusTurnId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadedConvId, setLoadedConvId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [instantBusy, setInstantBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(() => notifyPermission());
  // Messages waiting for a busy teammate, keyed by agent id (a teammate's
  // conversation can be replaced under them; the queue follows the person).
  const [queues, setQueues] = useState<ReadonlyMap<string, readonly QueuedMessage[]>>(() => new Map());

  const selected = team.find((t) => t.agent_id === selectedId) ?? null;
  const selectedConvId = selected?.conversation.id ?? null;
  const selectedConvRef = useRef<string | null>(null);
  selectedConvRef.current = selectedConvId;
  const teamRef = useRef<Teammate[]>([]);
  teamRef.current = team;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const queuesRef = useRef(queues);
  queuesRef.current = queues;

  const updatePrefs = useCallback((f: (p: Prefs) => Prefs) => {
    setPrefs((p) => {
      const next = f(p);
      savePrefs(next);
      return next;
    });
  }, []);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 5000);
  }, []);

  // ── roster ────────────────────────────────────────────────────────────────

  const refreshTeam = useCallback(async () => {
    try {
      const list = await client.listTeam();
      setTeam(list);
      setTeamError(null);
      return list;
    } catch (err) {
      setTeamError(describeError(err));
      return null;
    } finally {
      setTeamLoaded(true);
    }
  }, [client]);

  useEffect(() => {
    void refreshTeam();
  }, [refreshTeam]);

  // A debounced refresh for stage events, which arrive in bursts.
  const refreshTimer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refreshTeam();
    }, 250);
  }, [refreshTeam]);

  // ── selection & thread ────────────────────────────────────────────────────

  useEffect(() => {
    const onHash = () => {
      setSelectedId(idFromHash());
      setPage(pageFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = useCallback(
    (agentId: string | null) => {
      window.location.hash = agentId ? `#/team/${agentId}` : "";
      setPage("team");
      setSelectedId(agentId);
      setRenaming(false);
      if (agentId && prefsRef.current.unread.includes(agentId)) {
        updatePrefs((p) => ({ ...p, unread: without(p.unread, agentId) }));
      }
    },
    [updatePrefs],
  );

  useEffect(() => {
    if (!selectedConvId) {
      setTurns([]);
      setEvents([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    Promise.all([client.listTurns(selectedConvId), client.listAllEvents(selectedConvId, THREAD_STREAMS)])
      .then(([t, e]) => {
        if (cancelled) return;
        setTurns(t);
        setEvents(e);
        setLoadedConvId(selectedConvId);
      })
      .catch((err) => !cancelled && toast(describeError(err), "error"))
      .finally(() => !cancelled && setThreadLoading(false));
    client
      .markRead(selectedConvId)
      .then(() => setTeam((ts) => ts.map((t) => (t.conversation.id === selectedConvId ? { ...t, unread: false } : t))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, selectedConvId, toast]);

  // On a phone, the thread has no room for the roster: only one shows.
  const unreadCount = team.filter((t) => t.agent_id !== selectedId && (t.unread || prefs.unread.includes(t.agent_id))).length;
  useEffect(() => {
    const base = selected ? `${selected.name} · Team` : "Team";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [selected, unreadCount]);

  // ── queue-and-steer ───────────────────────────────────────────────────────

  const flushing = useRef(new Set<string>());

  /** Send everything queued for a teammate as one turn, now that they are free. */
  const flush = useCallback(
    async (agentId: string) => {
      const d = drain(queuesRef.current, agentId);
      if (!d || flushing.current.has(agentId)) return;
      flushing.current.add(agentId);
      try {
        const before = teamRef.current.find((t) => t.agent_id === agentId)?.conversation.id;
        const r = await client.sendMessage(agentId, d.prompt, d.images);
        setQueues((q) => withoutConversation(q, agentId));
        releaseImages(d.images);
        if (r.conversation_id !== before) await refreshTeam();
      } catch (err) {
        // still busy (a new turn started first) — keep it; the next turn end retries.
        if (err instanceof ApiError && (err.code === "conversation_busy" || err.status === 503)) return;
        toast(describeError(err), "error");
      } finally {
        flushing.current.delete(agentId);
      }
    },
    [client, refreshTeam, toast],
  );

  // Provisioning makes no event this stream delivers for a conversation it
  // only just started following, so a teammate whose computer is starting
  // (or whose machine is off, or whose queue waits on either) is polled
  // until the roster says otherwise.
  useEffect(() => {
    const waiting = team.some(
      (t) =>
        (t.presence.state === "starting" && t.conversation.sandbox?.status !== "ready") ||
        (queues.get(t.agent_id)?.length && t.presence.state !== "working" && t.conversation.status !== "running"),
    );
    if (!waiting) return;
    const id = window.setInterval(() => void refreshTeam(), 4000);
    return () => window.clearInterval(id);
  }, [team, queues, refreshTeam]);

  // A safety net for the event path: after any roster refresh, a free
  // teammate with a queue gets it (a reconnect can miss the turn-end event).
  useEffect(() => {
    for (const t of team) {
      if (!queues.get(t.agent_id)?.length) continue;
      // "starting" and "machine_offline" are not reasons to hold back: the
      // server answers 503 if it really cannot take the turn yet, and the
      // queue keeps it; a stale "starting" must not be the thing blocking.
      const busy = t.presence.state === "working" || t.conversation.status === "running";
      if (!busy) void flush(t.agent_id);
    }
  }, [team, queues, flush]);

  const notifyReply = useCallback(
    (agentId: string, conversationId: string) => {
      const p = prefsRef.current;
      if (
        !shouldNotify({
          enabled: p.notify,
          permission: notifyPermission(),
          muted: p.muted.includes(agentId),
          isOpen: conversationId === selectedConvRef.current,
          hidden: document.hidden,
        })
      )
        return;
      const t = teamRef.current.find((x) => x.agent_id === agentId);
      showReplyNotification({
        name: t?.name ?? "Teammate",
        body: t?.preview?.kind === "them" && t.preview.text ? t.preview.text : "replied",
        conversationId,
        onClick: () => select(agentId),
      });
    },
    [select],
  );

  const refreshSchedules = useCallback(async () => {
    try {
      setSchedules(await client.listSchedules());
    } catch (err) {
      toast(describeError(err), "error");
    }
  }, [client, toast]);

  // ── the team stream ───────────────────────────────────────────────────────

  useEffect(() => {
    const ctrl = new AbortController();
    let lastEventId: string | null = null;
    let backoff = 1000;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      void client.streamTeam({
        lastEventId,
        streams: THREAD_STREAMS,
        signal: ctrl.signal,
        onOpen: () => {
          setConnected(true);
          backoff = 1000;
          // Anything the roster missed while we were away.
          void refreshTeam();
        },
        onMessage: (msg) => {
          if (msg.id) lastEventId = msg.id;
          if (msg.event === "team") {
            void refreshTeam();
            setTeamVersion((v) => v + 1);
            return;
          }
          if (msg.event === "schedule") {
            setSchedules((cur) => {
              if (cur !== null) void refreshSchedules();
              return cur;
            });
            return;
          }
          let ev: TeamEvent;
          try {
            ev = JSON.parse(msg.data) as TeamEvent;
          } catch {
            return;
          }
          if (msg.id) ev.id = Number(msg.id);
          handleEvent(ev);
        },
        onClose: () => {
          setConnected(false);
          if (stopped) return;
          window.setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 15000);
        },
      });
    };

    const handleEvent = (ev: TeamEvent) => {
      const isSelected = ev.conversation_id === selectedConvRef.current;
      if (isSelected) {
        setEvents((es) => (es.some((e) => e.id === ev.id) ? es : [...es, ev]));
        if (ev.kind === "stage" && ev.stage === "turn") {
          if (ev.state === "started") {
            client.listTurns(ev.conversation_id).then(setTurns).catch(() => undefined);
          } else {
            client.listTurns(ev.conversation_id).then(setTurns).catch(() => undefined);
            client.markRead(ev.conversation_id).catch(() => undefined);
          }
        }
      }
      if (ev.kind === "stage") {
        if (ev.stage === "turn" && ev.state !== "started" && ev.agent_id) {
          const agentId = ev.agent_id;
          // Re-list first so the preview carries the reply, then notify and drain.
          void refreshTeam().then(() => {
            notifyReply(agentId, ev.conversation_id);
            void flush(agentId);
          });
        } else {
          scheduleRefresh();
        }
      } else if (ev.kind === "output") {
        // Someone else's row: bump it and show "typing…" without a query.
        setTeam((ts) =>
          ts
            .map((t): Teammate =>
              t.conversation.id === ev.conversation_id
                ? {
                    ...t,
                    conversation: { ...t.conversation, last_active_at: ev.ts },
                    preview: { kind: "typing", text: null },
                    unread: t.conversation.id !== selectedConvRef.current,
                  }
                : t,
            )
            .sort(byActivity),
        );
      }
    };

    connect();
    return () => {
      stopped = true;
      ctrl.abort();
    };
  }, [client, refreshTeam, refreshSchedules, scheduleRefresh, flush, notifyReply]);

  // ── routines ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (page === "routines" && schedules === null) void refreshSchedules();
  }, [page, schedules, refreshSchedules]);

  const openRoutines = useCallback((forAgentId: string | null = null) => {
    setRoutinesFor(forAgentId);
    window.location.hash = "#/routines";
    setPage("routines");
  }, []);

  const openRunners = useCallback(() => {
    window.location.hash = "#/runners";
    setPage("runners");
  }, []);

  // ── palette (⌘K) ──────────────────────────────────────────────────────────

  const orderedTeamRef = useRef<Teammate[]>([]);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const rows = orderedTeamRef.current;
        if (!rows.length) return;
        e.preventDefault();
        const cur = rows.findIndex((t) => t.agent_id === selectedRef.current);
        const next = e.key === "ArrowDown" ? Math.min(cur + 1, rows.length - 1) : Math.max(cur - 1, 0);
        if (next !== cur || cur === -1) select(rows[next === -1 ? 0 : next]!.agent_id);
        return;
      }
      if (e.key === "?" && !typing(e) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const exportTeam = useCallback(async () => {
    if (!team.length) {
      toast("Nothing to export — the team is empty");
      return;
    }
    try {
      const [agents, envs] = await Promise.all([Promise.all(team.map((t) => client.getAgent(t.agent_id))), client.listEnvironments()]);
      const yaml = teamManifest(
        team.map((t, i) => ({ name: t.name, agent: agents[i]! })),
        envs,
        new Date().toISOString(),
      );
      const blob = new Blob([yaml], { type: "application/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "team.yml";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(`Exported ${team.length} teammate${team.length === 1 ? "" : "s"} — apply with fountain apply -f team.yml`);
    } catch (err) {
      toast(describeError(err), "error");
    }
  }, [client, team, toast]);

  const openHit = useCallback(
    (hit: SearchHit) => {
      const t = teamRef.current.find((x) => x.conversation.id === hit.conversation_id);
      if (t) {
        select(t.agent_id);
        setFocusTurnId(hit.turn_id);
        return;
      }
      // An older conversation of a teammate, or one outside the team: Fountain shows it.
      window.open(`${client.baseUrl}/conversations/${hit.conversation_id}`, "_blank", "noopener");
    },
    [client.baseUrl, select],
  );

  const onPaletteChoice = useCallback(
    (choice: PaletteChoice) => {
      setPaletteOpen(false);
      switch (choice.kind) {
        case "teammate":
          select(choice.agentId);
          break;
        case "hit":
          openHit(choice.hit);
          break;
        case "routines":
          openRoutines();
          break;
        case "runners":
          openRunners();
          break;
        case "export":
          void exportTeam();
          break;
      }
    },
    [select, openHit, openRoutines, openRunners, exportTeam],
  );

  const renameTeammate = useCallback(
    async (agentId: string, name: string | null) => {
      const before = teamRef.current.find((t) => t.agent_id === agentId);
      if (!before) return;
      const optimistic = name ?? before.agent.name;
      setTeam((ts) => ts.map((t) => (t.agent_id === agentId ? { ...t, name: optimistic } : t)));
      try {
        const updated = await client.renameTeammate(agentId, name);
        setTeam((ts) => ts.map((t) => (t.agent_id === agentId ? { ...t, name: updated.name } : t)));
      } catch (err) {
        setTeam((ts) => ts.map((t) => (t.agent_id === agentId ? { ...t, name: before.name } : t)));
        toast(describeError(err), "error");
      }
    },
    [client, toast],
  );

  /** "+": a teammate right now — random name, default brain, avatar to follow. */
  const addInstant = useCallback(async () => {
    if (instantBusy) return;
    setInstantBusy(true);
    try {
      const { agentId, name } = await addInstantTeammate(client, { onAvatar: () => void refreshTeam() });
      await refreshTeam();
      select(agentId);
      toast(`${name} joined — rename them from the header; brain and "what they do" are in their profile`);
    } catch (err) {
      toast(describeError(err), "error");
    } finally {
      setInstantBusy(false);
    }
  }, [client, instantBusy, refreshTeam, select, toast]);

  // ── actions ───────────────────────────────────────────────────────────────

  const onSend = useCallback(
    async (text: string, images: OutgoingImage[]): Promise<"sent" | "queued"> => {
      if (!selected) throw new Error("no teammate selected");
      const agentId = selected.agent_id;
      const queue = () => {
        setQueues((q) => enqueue(q, agentId, { id: newQueuedId(), text, images, at: new Date().toISOString() }));
        return "queued" as const;
      };
      // Only a turn in flight is a reason not to try: "starting" and
      // "machine offline" are the server's call (503 → queued, below), and
      // the roster's idea of them can be stale.
      const busy = selected.presence.state === "working" || selected.conversation.status === "running";
      // Anything already queued goes first, so a new note joins the line.
      if (busy || queues.get(agentId)?.length) return queue();
      try {
        const r = await client.sendMessage(agentId, text, images);
        releaseImages(images);
        if (r.conversation_id !== selected.conversation.id) {
          // The old computer was gone; a fresh conversation is the thread now.
          await refreshTeam();
        }
        return "sent";
      } catch (err) {
        // The roster was stale: they are busy after all. Queue instead of bouncing.
        if (err instanceof ApiError && (err.code === "conversation_busy" || err.status === 503)) {
          void refreshTeam();
          return queue();
        }
        toast(describeError(err), "error");
        throw err;
      }
    },
    [client, selected, queues, refreshTeam, toast],
  );

  const onCancelQueued = useCallback(
    (id: string) => {
      if (!selected) return;
      const item = queues.get(selected.agent_id)?.find((m) => m.id === id);
      if (item) releaseImages(item.images);
      setQueues((q) => removeQueued(q, selected.agent_id, id));
    },
    [selected, queues],
  );

  const onToggleNotify = useCallback(async () => {
    if (prefs.notify) {
      updatePrefs((p) => ({ ...p, notify: false }));
      return;
    }
    const perm = await requestNotifyPermission();
    setNotifyPerm(perm);
    if (perm === "granted") {
      updatePrefs((p) => ({ ...p, notify: true }));
      toast("You'll be notified when a teammate replies");
    } else if (perm === "denied") {
      toast("Notifications are blocked for this site in your browser", "error");
    }
  }, [prefs.notify, updatePrefs, toast]);

  const onInterrupt = useCallback(() => {
    if (!selectedConvId) return;
    client
      .interrupt(selectedConvId)
      .then(() => toast("Interrupted"))
      .catch((err) => toast(describeError(err), "error"));
  }, [client, selectedConvId, toast]);

  const removeTeammate = useCallback(
    (agentId: string) => {
      const t = team.find((x) => x.agent_id === agentId);
      if (!t) return;
      if (!window.confirm(`Remove ${t.name} from the team? Their computer is shut down; the conversation stays in your Fountain history.`)) return;
      client
        .removeTeammate(agentId)
        .then(() => {
          toast("Removed from the team");
          if (selectedId === agentId) select(null);
          setQueues((q) => withoutConversation(q, agentId));
          return refreshTeam();
        })
        .catch((err) => toast(describeError(err), "error"));
    },
    [client, team, selectedId, refreshTeam, select, toast],
  );

  /**
   * Start a fresh thread with a teammate. By default they keep their computer: the current
   * conversation is retired (it stays in History) and a new one opens on the same sandbox, so
   * the next message starts with a clean context but the files and tools still there. With
   * `newComputer`, the current conversation and its computer are terminated instead and the
   * next message provisions a new one.
   */
  const retireThread = useCallback(
    (agentId: string, opts: { newComputer?: boolean } = {}) => {
      const t = team.find((x) => x.agent_id === agentId);
      if (!t) return;
      if (opts.newComputer) {
        const live = t.conversation.status !== "terminated" && t.conversation.status !== "failed";
        // A thread nothing has happened on yet has nothing to lose — no need to ask
        // (customize → "restart their computer" is the usual way here).
        if (
          live &&
          t.conversation.turn_count > 0 &&
          !window.confirm(
            `Start a fresh thread with ${t.name} on a new computer? This ends the current conversation and shuts down its computer (anything not committed or pushed from that computer is gone). The thread stays under History; a new computer starts now.`,
          )
        )
          return;
        // End the current computer, then open the new conversation right away: with the old one
        // past resuming, Fountain opens it on a fresh sandbox and provisions immediately, so the
        // thread goes "Starting their computer…" → "ready" without waiting for a first message.
        (live ? client.terminate(t.conversation.id) : Promise.resolve())
          .then(() => client.freshConversation(agentId))
          .then(() => {
            toast(`Starting ${t.name}'s new computer…`);
            setQueues((q) => withoutConversation(q, agentId));
            return refreshTeam();
          })
          .catch((err) => {
            if (err instanceof ApiError && err.code === "conversation_busy") {
              toast(`${t.name} is still working — interrupt or wait for the turn to end, then try again.`, "error");
              return;
            }
            toast(describeError(err), "error");
          });
        return;
      }
      const keeps = t.conversation.status !== "terminated" && t.conversation.status !== "failed";
      if (
        !window.confirm(
          keeps
            ? `Start a fresh thread with ${t.name}? The current conversation ends and stays under History. ${t.name} keeps the same computer — files and tools stay — and the next message begins the new thread with a clean slate.`
            : `Start a fresh thread with ${t.name}? The old thread stays under History; a new computer is started for the new one.`,
        )
      )
        return;
      client
        .freshConversation(agentId)
        .then(() => {
          toast(keeps ? `Fresh thread — ${t.name} is on the same computer` : `Fresh thread — starting ${t.name}'s computer`);
          setQueues((q) => withoutConversation(q, agentId));
          return refreshTeam();
        })
        .catch((err) => {
          if (err instanceof ApiError && err.code === "conversation_busy") {
            toast(`${t.name} is still working — interrupt or wait for the turn to end, then try again.`, "error");
            return;
          }
          toast(describeError(err), "error");
        });
    },
    [client, team, refreshTeam, toast],
  );

  const onRemove = useCallback(() => {
    if (selected) removeTeammate(selected.agent_id);
  }, [selected, removeTeammate]);

  const onRowAction = useCallback(
    (agentId: string, action: RowAction) => {
      const t = team.find((x) => x.agent_id === agentId);
      switch (action) {
        case "pin":
          updatePrefs((p) => ({ ...p, pinned: toggleIn(p.pinned, agentId) }));
          break;
        case "mute":
          updatePrefs((p) => ({ ...p, muted: toggleIn(p.muted, agentId) }));
          break;
        case "unread":
          updatePrefs((p) => ({ ...p, unread: p.unread.includes(agentId) ? p.unread : [...p.unread, agentId] }));
          break;
        case "read":
          updatePrefs((p) => ({ ...p, unread: without(p.unread, agentId) }));
          if (t?.unread) {
            client
              .markRead(t.conversation.id)
              .then(() => setTeam((ts) => ts.map((x) => (x.agent_id === agentId ? { ...x, unread: false } : x))))
              .catch((err) => toast(describeError(err), "error"));
          }
          break;
        case "copy-id":
          if (t) {
            navigator.clipboard
              .writeText(t.conversation.id)
              .then(() => toast("Conversation id copied"))
              .catch(() => toast(t.conversation.id));
          }
          break;
        case "open":
          if (t) window.open(`${client.baseUrl}/conversations/${t.conversation.id}`, "_blank", "noopener");
          break;
        case "remove":
          removeTeammate(agentId);
          break;
        case "rename":
          select(agentId);
          setRenaming(true);
          break;
        case "history":
          select(agentId);
          setHistoryFor(agentId);
          break;
        case "retire":
          retireThread(agentId);
          break;
        case "retire-new":
          retireThread(agentId, { newComputer: true });
          break;
      }
    },
    [team, client, updatePrefs, removeTeammate, retireThread, toast, select],
  );

  const orderedTeam = useMemo(() => sortPinnedFirst(team, prefs.pinned), [team, prefs.pinned]);
  orderedTeamRef.current = orderedTeam;

  const onTeamIds = useMemo(() => new Set(team.map((t) => t.agent_id)), [team]);

  return (
    <div className={`app ${selected || page !== "team" ? "thread-open" : ""}`}>
      <Roster
        client={client}
        loaded={teamLoaded}
        teammates={orderedTeam}
        selectedId={selectedId}
        prefs={prefs}
        notifyPermission={notifyPerm}
        onSelect={select}
        onAdd={() => void addInstant()}
        onAddExisting={() => setAdding(true)}
        adding={instantBusy}
        onSettings={onSettings}
        onSignOut={onSignOut}
        onToggleNotify={() => void onToggleNotify()}
        onRowAction={onRowAction}
        onRoutines={() => openRoutines()}
        onPalette={() => setPaletteOpen(true)}
        onExport={() => void exportTeam()}
        onShortcuts={() => setShortcutsOpen(true)}
        onRunners={openRunners}
        connected={connected}
      />
      {page === "runners" ? (
        <Runners client={client} onBack={() => select(null)} toast={toast} fountainUrl={client.baseUrl} refreshKey={teamVersion} />
      ) : page === "routines" ? (
        <Routines
          client={client}
          teammates={orderedTeam}
          schedules={schedules}
          forAgentId={routinesFor}
          onRefresh={refreshSchedules}
          onBack={() => select(null)}
          onOpenTeammate={select}
          toast={toast}
          fountainUrl={client.baseUrl}
        />
      ) : selected ? (
        <Thread
          client={client}
          teammate={selected}
          turns={turns}
          events={events}
          queued={queues.get(selected.agent_id) ?? []}
          loading={threadLoading || loadedConvId !== selected.conversation.id}
          onSend={onSend}
          onCancelQueued={onCancelQueued}
          onInterrupt={onInterrupt}
          onRemove={onRemove}
          onBack={() => select(null)}
          onError={(text) => toast(text, "error")}
          onRoutines={() => openRoutines(selected.agent_id)}
          onHistory={() => setHistoryFor(selected.agent_id)}
          onRetire={() => retireThread(selected.agent_id, { newComputer: true })}
          onRename={(name) => renameTeammate(selected.agent_id, name)}
          renaming={renaming}
          onRenamingChange={setRenaming}
          focusTurnId={focusTurnId}
          onFocused={() => setFocusTurnId(null)}
          onAgentChanged={() => void refreshTeam()}
          activityOpen={prefs.activity}
          onActivityChange={(open) => updatePrefs((p) => ({ ...p, activity: open }))}
          fountainUrl={client.baseUrl}
        />
      ) : !teamLoaded ? (
        <section className="thread placeholder" aria-busy="true" />
      ) : team.length === 0 ? (
        <Onboarding onAdd={() => void addInstant()} onAddExisting={() => setAdding(true)} busy={instantBusy} error={teamError} />
      ) : (
        <section className="thread placeholder">
          <div className="centered muted">{teamError ? teamError : "Pick a teammate to open the conversation."}</div>
        </section>
      )}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
      {historyFor && team.find((t) => t.agent_id === historyFor) && (
        <History
          client={client}
          teammate={team.find((t) => t.agent_id === historyFor)!}
          onClose={() => setHistoryFor(null)}
          onOpenCurrent={() => {
            select(historyFor);
            setHistoryFor(null);
          }}
          onRetire={(newComputer) => {
            setHistoryFor(null);
            retireThread(historyFor, { newComputer });
          }}
          fountainUrl={client.baseUrl}
        />
      )}
      {paletteOpen && <Palette client={client} teammates={orderedTeam} onChoose={onPaletteChoice} onClose={() => setPaletteOpen(false)} />}
      {adding && (
        <AddDialog
          client={client}
          onTeam={onTeamIds}
          onClose={() => setAdding(false)}
          onAdded={(agentId) => {
            setAdding(false);
            void refreshTeam().then(() => select(agentId));
          }}
        />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function idFromHash(): string | null {
  const m = /^#\/team\/([0-9a-f-]{36})$/.exec(window.location.hash);
  return m?.[1] ?? null;
}

function pageFromHash(): "team" | "routines" | "runners" {
  if (window.location.hash === "#/routines") return "routines";
  if (window.location.hash === "#/runners") return "runners";
  return "team";
}

function byActivity(a: Teammate, b: Teammate): number {
  return (b.conversation.last_active_at ?? "").localeCompare(a.conversation.last_active_at ?? "");
}
