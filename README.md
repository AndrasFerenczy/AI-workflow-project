# Mini AI Workflow Builder

A local web app for configuring AI workflows from a **system prompt**, **tools**, and a **step / decision sequence**, then chatting with them. Workflows are saved in SQLite and every run keeps a full execution trace.

Built with Next.js 16, Prisma 7, OpenAI / Anthropic / DeepSeek, and Tailwind CSS.

## Features

- Visual workflow builder: name, system prompt, provider/model, drag-and-drop steps
- Step types: `agent`, `tool`, `decision`, `respond`
- Per-agent-step tool selection (Web research bundles search + fetch URL)
- Workflow versioning (snapshot on every save, restore from history)
- Tools: calculator, web research (search + fetch), mock email sender, current time
- Multi-provider LLM layer (OpenAI, Anthropic, DeepSeek); keys via welcome screen, Settings, or `.env`
- Chat with streaming replies and traces of LLM calls, tool calls, and branch decisions
- Persisted execution history and a mock email outbox
- Three seeded demo workflows (research, math tutor, support triage)
- Docker Compose setup

## Prerequisites

- Node.js 22+ **or** Docker Desktop / Compose v2
- An API key for at least one provider:
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Anthropic](https://console.anthropic.com/settings/keys)
  - [DeepSeek](https://platform.deepseek.com/api_keys)

## Setup (local)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Put at least one provider key in .env (or paste it on the welcome screen after start)

# 3. Generate Prisma client, create SQLite DB, seed demos
npm run setup

# 4. Start the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first visit, the welcome screen asks for an API key if none is configured yet. Keys can also be managed under **Settings**.

## Setup (Docker)

```bash
cp .env.example .env
# set OPENAI_API_KEY, ANTHROPIC_API_KEY, and/or DEEPSEEK_API_KEY

docker compose up --build
# or: npm run docker:up
```

App: [http://localhost:3000](http://localhost:3000). SQLite lives in the `workflow-sqlite` volume. Demo workflows re-seed on start by default; set `SEED_ON_START=false` once you want restarts to leave data alone.

```bash
docker compose down          # stop
docker compose down -v       # stop and wipe the database volume
```

### Useful scripts

| Script | What it does |
| --- | --- |
| `npm run setup` | `prisma generate` + `db push` + seed |
| `npm run db:seed` | Re-seed the three demo workflows |
| `npm run db:reset` | Wipe the database and re-seed |
| `npm run db:studio` | Open Prisma Studio |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build |
| `npm run docker:up` | `docker compose up --build` |
| `npm run docker:down` | `docker compose down` |

## Quick tour

1. Open **Workflows** — you should see Research Assistant, Math Tutor, and Support Triage.
2. Click **Edit** on Math Tutor to inspect the two-step pipeline (Solve → Explain).
3. Click **Chat**, ask `What is 17 * 43?`, and expand the execution trace under the reply.
4. Try Support Triage with a billing question to see a decision branch and a mock email in **Outbox**.
5. Open **History** to replay any past run.

## Environment variables

See [`.env.example`](.env.example). The important ones:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | SQLite path, default `file:./prisma/dev.db` |
| `OPENAI_API_KEY` | one of the keys | OpenAI (or OpenAI-compatible) access |
| `ANTHROPIC_API_KEY` | one of the keys | Anthropic access |
| `DEEPSEEK_API_KEY` | one of the keys | DeepSeek (`deepseek-v4-flash` / `deepseek-v4-pro`) |
| `OPENAI_BASE_URL` | no | Point the OpenAI adapter at OpenRouter / Groq / Ollama / etc. |
| `WORKFLOW_MAX_ITERATIONS` | no | Cap on tool loops inside an agent step (default 8) |
| `WORKFLOW_MAX_STEPS` | no | Cap on steps per run (default 25) |
| `WORKFLOW_TIMEOUT_MS` | no | Wall-clock budget per run (default 120000) |

## Architecture & design decisions

See [ARCHITECTURE.md](./ARCHITECTURE.md) — that is the short write-up requested in the brief.

## Project layout

```
src/
  app/                  # Next.js App Router pages + API routes
  components/           # UI primitives, nav, run trace
  lib/
    engine/             # Workflow executor, templates, events
    llm/                # Provider registry (OpenAI, Anthropic, DeepSeek)
    tools/              # Tool registry and implementations
    workflow/           # Persistence, DTOs, Zod schemas
  generated/prisma/     # Generated Prisma client (gitignored)
prisma/
  schema.prisma
  seed.ts
```

## Submission checklist

- [ ] Public GitHub repo (do **not** commit `.env` — only `.env.example`)
- [ ] This README with setup instructions
- [ ] `.env.example`
- [ ] [ARCHITECTURE.md](./ARCHITECTURE.md) design write-up
