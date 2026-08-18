import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FountainClient, describeError } from "./api/client";
import type { LogEvent, TeamEvent, Teammate, Turn } from "./api/types";
import { clearSettings, loadSettings, saveSettings, type Settings } from "./lib/settings";
import { SettingsScreen } from "./components/Settings";
import { Roster } from "./components/Roster";
import { Thread } from "./components/Thread";
import { AddDialog } from "./components/AddDialog";

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

  if (!settings || editingSettings) {
    return (
      <SettingsScreen
        initial={settings}
        onCancel={settings ? () => setEditingSettings(false) : undefined}
        onConnected={(s, who) => {
          saveSettings(s);
          setSettings(s);
          setEmail(who);
          setEditingSettings(false);
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
        clearSettings();
        setSettings(null);
      }}
    />
  );
}

function Team({ settings, onSettings }: { settings: Settings; email: string | null; onSettings: () => void; onSignOut: () => void }) {
  const client = useMemo(() => new FountainClient(settings), [settings]);
  const [team, setTeam] = useState<Teammate[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => idFromHash());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const selected = team.find((t) => t.agent_id === selectedId) ?? null;
  const selectedConvId = selected?.conversation.id ?? null;
  const selectedConvRef = useRef<string | null>(null);
  selectedConvRef.current = selectedConvId;

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
    const onHash = () => setSelectedId(idFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = useCallback((agentId: string | null) => {
    window.location.hash = agentId ? `#/team/${agentId}` : "";
    setSelectedId(agentId);
  }, []);

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
  useEffect(() => {
    document.title = selected ? `${selected.name} · Team` : "Team";
  }, [selected]);

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
        scheduleRefresh();
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
  }, [client, refreshTeam, scheduleRefresh]);

  // ── actions ───────────────────────────────────────────────────────────────

  const onSend = useCallback(
    async (text: string) => {
      if (!selected) return;
      try {
        const r = await client.sendMessage(selected.agent_id, text);
        if (r.conversation_id !== selected.conversation.id) {
          // The old computer was gone; a fresh conversation is the thread now.
          await refreshTeam();
        }
      } catch (err) {
        toast(describeError(err), "error");
        throw err;
      }
    },
    [client, selected, refreshTeam, toast],
  );

  const onInterrupt = useCallback(() => {
    if (!selectedConvId) return;
    client
      .interrupt(selectedConvId)
      .then(() => toast("Interrupted"))
      .catch((err) => toast(describeError(err), "error"));
  }, [client, selectedConvId, toast]);

  const onRemove = useCallback(() => {
    if (!selected) return;
    if (!window.confirm(`Remove ${selected.name} from the team? Their computer is shut down; the conversation stays in your Fountain history.`)) return;
    client
      .removeTeammate(selected.agent_id)
      .then(() => {
        toast("Removed from the team");
        select(null);
        return refreshTeam();
      })
      .catch((err) => toast(describeError(err), "error"));
  }, [client, selected, refreshTeam, select, toast]);

  const onTeamIds = useMemo(() => new Set(team.map((t) => t.agent_id)), [team]);

  return (
    <div className={`app ${selected ? "thread-open" : ""}`}>
      <Roster
        client={client}
        teammates={team}
        selectedId={selectedId}
        onSelect={select}
        onAdd={() => setAdding(true)}
        onSettings={onSettings}
        connected={connected}
      />
      {selected ? (
        <Thread
          teammate={selected}
          turns={turns}
          events={events}
          loading={threadLoading}
          onSend={onSend}
          onInterrupt={onInterrupt}
          onRemove={onRemove}
          onBack={() => select(null)}
          fountainUrl={client.baseUrl}
        />
      ) : (
        <section className="thread placeholder">
          <div className="centered muted">
            {teamError
              ? teamError
              : team.length > 0
                ? "Pick a teammate to open the conversation."
                : "Your team's conversations will show here."}
          </div>
        </section>
      )}
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

function byActivity(a: Teammate, b: Teammate): number {
  return (b.conversation.last_active_at ?? "").localeCompare(a.conversation.last_active_at ?? "");
}
