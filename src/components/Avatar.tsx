import { useEffect, useState } from "react";
import type { Agent } from "../api/types";
import type { FountainClient } from "../api/client";

export function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!)
    .join("")
    .toUpperCase();
}

const cache = new Map<string, string>();

/** The agent's avatar, fetched with the bearer key (an <img src> cannot send one). */
export function Avatar({ agent, name, client, size = 44 }: { agent: Agent; name: string; client: FountainClient; size?: number }) {
  const [url, setUrl] = useState<string | null>(cache.get(agent.id) ?? null);

  useEffect(() => {
    if (!agent.avatar_media_type || cache.has(agent.id)) return;
    let cancelled = false;
    client
      .fetchRaw(`/api/agents/${agent.id}/avatar`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        const u = URL.createObjectURL(blob);
        cache.set(agent.id, u);
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.avatar_media_type, client]);

  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {url ? <img src={url} alt="" /> : <span>{initials(name) || "?"}</span>}
    </div>
  );
}
