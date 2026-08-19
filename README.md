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

On first load, enter your Fountain URL and **Sign in with Fountain** — it opens
Fountain to approve access and brings you back signed in, nothing to copy
(OAuth 2.0 authorization code + PKCE; the token is an API key that lists and
revokes under Account → API keys, and signing out revokes it). Pasting an API
key still works as a fallback. Everything stays in this browser's
`localStorage`.

For "Sign in with Fountain" the server must register this app in
`OAUTH_CLIENTS` (client id `fountain-team`, redirect URI = where you host it)
as well as `API_CORS_ORIGINS`.

The Fountain server has to allow the browser origin — a browser calling
another site's API is a CORS request. Set on the server:

```
API_CORS_ORIGINS=http://localhost:5173        # dev
API_CORS_ORIGINS=https://jakegaylor.com       # wherever you host the build
```

That switch is off by default and only ever admits a presented bearer key —
cookies never cross origins — so turning it on for your own client is safe.

## What it does

Beyond the roster and the thread — the things a messaging app is expected to
do, each on the public API:

- **Send while they're busy.** A message to a teammate mid-turn does not
  bounce: it queues in the thread (dashed bubble, ⏱ send button) and is sent
  the moment the turn ends — several queued notes go as one turn. Interrupt,
  then queue a correction, and the correction runs. Cancel a queued note from
  its bubble.
- **Images.** Paste, drop, or attach png/jpeg/gif/webp (10 MB each); they go
  with the prompt and show in the thread, fetched back from the API.
- **Notifications.** The bell in the roster header asks the browser once;
  after that a reply from a teammate you're not looking at (or in a
  background tab) raises a desktop notification that opens the thread. Mute
  a teammate from the row menu. The tab title carries the unread count.
- **Row menu** (right-click, or ⋯ on hover): pin to top, mute, mark as
  unread / read, open in Fountain, copy the conversation id, remove.
- **Drafts** survive switching teammates and reloads.
- **Reading is not interrupted.** New content only scrolls the thread when
  you were already at the bottom; otherwise a "New messages ↓" pill waits.
  Long threads render the last 40 turns with "Show earlier messages".

- **Routines** (team menu ⋯ → Routines, or from a thread header): the
  schedules that run a teammate with a prompt — in their thread or on a
  one-off computer. Presets or a custom cron (UTC), pause/resume, run now,
  edit, delete; the list follows the stream's `schedule` event.
- **⌘K** (Ctrl+K): jump to a teammate by name, a couple of commands, and
  full-text search across every conversation — pick a hit and the thread
  opens scrolled to that turn, highlighted. Hits outside the team open in
  Fountain.
- **Token usage**: per turn under the reply, and per teammate in the thread
  header (summed over every conversation they've had on the team).
- **Spawned**: when a teammate opened sub-conversations, a "Spawned · n"
  button in the thread header lists them (`/tree`).
- **Export** (team menu ⋯): the team as a `fountain apply` manifest —
  one `Agent` document per teammate; import is `fountain apply -f team.yml`.
- **Activity** (thread header): a sidebar with what the teammate is doing
  as it narrates it — prose between folded "Ran N tool calls ▾" rows that
  open to the calls with status, duration and output, per turn, live. In the
  chat itself a tool run is just a status line ("Ran Terminal 3.0s ›");
  clicking it opens Activity at that run. Built from the ACP events already
  on the stream.
- **Markdown** in replies — headings, lists, tables, code blocks with Copy,
  links (http/https/mailto only) — rendered from a small parser in
  `src/lib/markdown.ts` to React elements, never HTML, so nothing an agent
  writes can inject markup. Roster previews show the plain text.
- **About a teammate** (click the thread title): the agent behind them —
  model, runtime, description, system prompt, skills, MCP servers,
  environment, vault, computer — and links to edit the agent in Fountain.
- **Keyboard**: ⌘K search, Alt+↑/↓ to switch teammates, `?` for the list.
- **Rename** a teammate (✎ by the name, or the row menu); empty resets to the
  agent's name. **History** (thread header / row menu): its previous
  conversations — earlier computers' threads — readable in place. **Start a
  fresh thread…** (row menu / History) retires the current one: its computer
  shuts down, the thread stays in History, the next message starts a new one.
- **Runners** (team menu ⋯): your own machines serving as a teammate's
  computer (Fountain's self-hosted runner): which are online, forget one,
  how to start `fountain runner`. A teammate on a runner shows "on
  <machine> · path" in the header; when that machine is off its presence is
  *machine offline* and messages queue until the runner reconnects.

Pins, mutes, marks and drafts live in this browser's `localStorage`; Fountain
has no field for them.

## Develop against a Fountain without CORS

```bash
FOUNTAIN_PROXY=https://your-fountain.example bun run dev
```

forwards `/api` from the dev server, so enter `http://localhost:5173` as the
Fountain URL and paste a key (OAuth needs the real origin).

## Build and host

```bash
bun run build      # dist/ — static, host it anywhere
```

Any static host works (Cloudflare Pages, GitHub Pages, an nginx container, an
S3 bucket). The only build-time knob is `VITE_BASE`, the path the files are
served under (default `/`); the Fountain URL is entered in the app.

This repo deploys itself to GitHub Pages on every push to `main`
(`.github/workflows/pages.yml`): https://jakegaylor.com/fountain-team/ (the
Pages site sits behind that custom domain) — so the origin to allow on the
server is `https://jakegaylor.com`.

## What it uses

Everything is the public API (`docs/api.md` in Fountain, "Team"):

| In the app | API |
|---|---|
| Roster, presence, previews, unread | `GET /api/team` |
| Add (name, environment, vault) | `POST /api/team`, with `GET /api/agents`, `/api/environments`, `/api/vaults` for the picker |
| Send (text + images) | `POST /api/team/:agent_id/messages`; `GET /api/conversations/:id/turns/:turn_id/images/:pos` to show them back |
| Thread | `GET /api/conversations/:id/turns` + `/events` |
| Live updates | `GET /api/team/stream` — one SSE connection for the whole team, `Last-Event-ID` on reconnect |
| Read state | `POST /api/conversations/:id/read` |
| Interrupt / Remove | `POST /api/conversations/:id/interrupt`, `DELETE /api/team/:agent_id` |
| Routines | `GET /api/team/schedules`, `POST/PATCH/DELETE /api/team/:agent_id/schedules[/:id]`, `POST …/:id/run` |
| Search (⌘K) | `GET /api/search?q=` |
| Usage | `usage` on turns, `usage_total` on the roster |
| Spawned | `GET /api/conversations/:id/tree` |
| Export | `GET /api/agents/:id` + `/api/environments`, emitted as YAML client-side |
| Rename / History | `PATCH /api/team/:agent_id`, `GET /api/team/:agent_id/conversations` |
| Runners | `GET /api/runners`, `DELETE /api/runners/:id`; `sandbox.runner` + `machine_offline` presence on the roster |

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
