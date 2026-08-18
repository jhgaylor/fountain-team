# fountain-team

A messaging-style client for your [Fountain](https://github.com/BinaryBourbon/fountain)
team: your agents as teammates, one ongoing conversation each — the roster on
the left, the thread on the right, Enter to send. It is the `/team` page as a
standalone app: static files, no backend of its own, talking only to the
Fountain API with an API key you paste in once.

## Run it

```bash
bun install
bun run dev        # http://localhost:5173
```

On first load it asks for your Fountain URL and an API key (make one under
*Account → API keys*). Both stay in this browser's `localStorage`.

The Fountain server has to allow the browser origin — a browser calling
another site's API is a CORS request. Set on the server:

```
API_CORS_ORIGINS=http://localhost:5173        # dev
API_CORS_ORIGINS=https://team.example.com     # wherever you host the build
```

That switch is off by default and only ever admits a presented bearer key —
cookies never cross origins — so turning it on for your own client is safe.

## Build and host

```bash
bun run build      # dist/ — static, host it anywhere
```

Any static host works (Cloudflare Pages, GitHub Pages, an nginx container, an
S3 bucket). There is nothing to configure at build time: the Fountain URL is
entered in the app.

## What it uses

Everything is the public API (`docs/api.md` in Fountain, "Team"):

| In the app | API |
|---|---|
| Roster, presence, previews, unread | `GET /api/team` |
| Add (name, environment, vault) | `POST /api/team`, with `GET /api/agents`, `/api/environments`, `/api/vaults` for the picker |
| Send | `POST /api/team/:agent_id/messages` |
| Thread | `GET /api/conversations/:id/turns` + `/events` |
| Live updates | `GET /api/team/stream` — one SSE connection for the whole team, `Last-Event-ID` on reconnect |
| Read state | `POST /api/conversations/:id/read` |
| Interrupt / Remove | `POST /api/conversations/:id/interrupt`, `DELETE /api/team/:agent_id` |

`EventSource` cannot send an `Authorization` header, so the stream is read
with `fetch` and parsed in `src/lib/sse.ts`. The ACP output is turned into
bubbles in `src/lib/acp.ts`, a port of Fountain's own `ACP.Blocks`; both have
unit tests (`bun test`).

## Develop

```bash
bun run typecheck
bun test
```

Vite + React + TypeScript, no other runtime dependencies. Bun is the toolchain
(`bun install`, `bunx vite`); Node works too if you prefer it.
