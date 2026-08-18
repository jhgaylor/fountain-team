import type { Teammate } from "../api/types";
import type { FountainClient } from "../api/client";
import { Avatar } from "./Avatar";

interface Props {
  client: FountainClient;
  teammates: Teammate[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  connected: boolean;
}

export function Roster({ client, teammates, selectedId, onSelect, onAdd, onSettings, connected }: Props) {
  return (
    <aside className="roster">
      <header className="roster-header">
        <h1>
          Team
          <span className={`link-dot ${connected ? "on" : "off"}`} title={connected ? "Live" : "Reconnecting…"} />
        </h1>
        <div className="row">
          <button className="icon" onClick={onSettings} aria-label="Settings" title="Settings">
            ⚙
          </button>
          <button className="icon primary" onClick={onAdd} aria-label="Add a teammate" title="Add a teammate">
            +
          </button>
        </div>
      </header>
      <div className="roster-list">
        {teammates.length === 0 && (
          <div className="empty">
            <p>No one on the team yet.</p>
            <p className="muted">
              Add an agent and it gets its own computer and one ongoing conversation with you — like a
              coworker in your messages.
            </p>
            <button onClick={onAdd}>Add a teammate</button>
          </div>
        )}
        <ul>
          {teammates.map((t) => (
            <RosterRow
              key={t.agent_id}
              client={client}
              teammate={t}
              selected={t.agent_id === selectedId}
              onSelect={() => onSelect(t.agent_id)}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
}

function RosterRow({ client, teammate: t, selected, onSelect }: { client: FountainClient; teammate: Teammate; selected: boolean; onSelect: () => void }) {
  const unread = !selected && t.unread;
  return (
    <li>
      <button className={`roster-row ${selected ? "selected" : ""}`} onClick={onSelect}>
        <div className="avatar-wrap">
          <Avatar agent={t.agent} name={t.name} client={client} />
          <span className={`presence ${t.presence.state}`} title={t.presence.label} />
        </div>
        <div className="roster-text">
          <div className="roster-line">
            <span className="name">{t.name}</span>
            <span className="time">{formatTime(t.conversation.last_active_at)}</span>
          </div>
          <div className="roster-line">
            <span className={`preview ${unread ? "unread" : ""}`}>
              <PreviewText t={t} />
            </span>
            {unread && <span className="unread-dot" title="Unread" />}
          </div>
        </div>
      </button>
    </li>
  );
}

function PreviewText({ t }: { t: Teammate }) {
  const p = t.preview;
  if (!p) return <em>No messages yet</em>;
  if (p.kind === "typing") return <em>typing…</em>;
  return (
    <>
      {p.kind === "you" && "You: "}
      {p.text}
    </>
  );
}

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
