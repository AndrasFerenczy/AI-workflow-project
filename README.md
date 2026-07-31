# Mini AI Workflow Builder

A containerized local web app for configuring AI workflows from a system prompt, tools, and a step / decision sequence, with the goal of chatting with them.

Built with Next.js 16, Prisma 7, OpenAI / Anthropic / DeepSeek API, and Tailwind CSS.

## Prerequisites

- **Docker** with Compose v2 — [Docker Desktop](https://docs.docker.com/get-docker/) (Mac / Windows) or [Docker Engine](https://docs.docker.com/engine/install/) (Linux)

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/Oraczen.git
cd Oraczen
```

### 2. Build & launch

```bash
docker compose up --build
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

On first visit, the app walks you through a setup screen where you can paste your API key (OpenAI, Anthropic, or DeepSeek), which will then be written into the .env file. Keys can also be changed later under **Settings**.

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

### Data persistence

SQLite lives in a Docker named volume (`workflow-sqlite`). Your data survives container restarts. Demo workflows re-seed on every start by default — set `SEED_ON_START=false` in `.env` once you want restarts to leave your data untouched.

## Project Layout

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
docker/
  entrypoint.sh         # Container startup (schema push + optional seed)
Dockerfile              # Multi-stage build
docker-compose.yml      # Single-command launch
```
