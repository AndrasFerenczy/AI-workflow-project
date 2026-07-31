# Architecture & design decisions

Short write-up for the take-home: why the system is shaped this way, how a run works, and how it stays extensible.

## Goal

The brief asks for a **configurable AI system**, not a single hardcoded agent. Every run is assembled from database rows: model, system prompt, allowed tools, and the step graph. Adding a tool or provider is a new file registered in one place.

## High-level flow

```
Browser (builder / chat)
    │
    ▼
Next.js route handlers  (/api/workflows, /api/workflows/[id]/chat, …)
    │
    ├── Prisma / SQLite     (workflows, sessions, runs, events, emails, settings)
    │
    └── Workflow executor
            ├── Tool registry
            └── LLM provider registry  (OpenAI | Anthropic | DeepSeek)
```

A chat turn:

1. Loads the workflow and prior session messages.
2. Creates a `Run` in `running` state.
3. Walks the step list (or one implicit `agent` step when the list is empty).
4. Appends LLM calls, tool calls, tool results, and branch decisions to a `RunEventCollector`.
5. Streams user-facing tokens over SSE when appropriate; persists events, run status, and messages.

The chat UI shows the reply plus a collapsible trace of those events.

## Why this shape

**One Next.js app.** Persistence, orchestration, and UI share TypeScript types and Zod schemas. For a take-home, `npm run setup && npm run dev` (or Docker) beats a split frontend/backend repo.

**Registries over switch statements.** Tools live in `src/lib/tools/`; providers in `src/lib/llm/`. The executor and UI only know the registry interface, so extensions stay additive.

**Steps as data.** Four step types cover “sequence of steps, or a simple decision flow”:

| Type | Behaviour |
| --- | --- |
| `agent` | LLM ↔ tool loop with a chosen subset of tools, bounded by `maxIterations` |
| `tool` | Always run one tool (args from the LLM or a JSON template) |
| `decision` | LLM picks a labelled branch; engine jumps to that step key |
| `respond` | Compose the final user-facing answer from gathered state |

Empty step lists fall back to one implicit `agent` using workflow-enabled tools. Simple workflows (Research Assistant) stay configuration-light without a second code path.

**Tools on the agent step.** Enabling tools is a per-step concern in the builder (what *this* agent may call). Workflow-level enabled flags are derived on save for listing/history. Web search and fetch URL share one **Web research** toggle because users think of them as one capability; both tools remain available to the model.

**Neutral LLM messages.** Adapters map to OpenAI Chat Completions (shared by OpenAI and DeepSeek) and Anthropic Messages. The executor never branches on provider id.

**Events as the source of truth for traces.** The executor only appends to a collector; persistence and the API read the same list, so the UI cannot drift from what ran.

**Streaming with intent.** Chat uses SSE (`stream: true`). Intermediate tool/decision rounds stay out of the bubble; tokens surface for `respond` steps, or for an `agent` when no later `respond` will write the answer. That keeps the stream feeling like a reply, not a dump of scratch work.

**Keys in two places.** `.env` for local/Docker defaults; welcome screen + Settings persist overrides in SQLite so reviewers can paste a key without editing files.

## Data model

- `Workflow` — prompt, provider, model, temperature, iteration budget
- `WorkflowTool` — per-workflow enable/disable (for list views / defaults)
- `WorkflowStep` — ordered nodes with a stable `key` for templates and branches
- `WorkflowVersion` — snapshot on save for restore
- `ChatSession` / `Message` — conversation memory, separate from traces
- `Run` / `RunEvent` — execution history; runs survive session deletion
- `EmailLog` — mock outbox for `send_email`
- `Setting` — API key overrides and welcome completion

SQLite + Prisma 7 (`@prisma/adapter-better-sqlite3`). No Docker required for the happy path; Compose is available for a one-command demo.

## Tools

Each tool is a `ToolDefinition`: Zod params (JSON Schema for the LLM via `z.toJSONSchema`), `execute`, optional `summarize` for the timeline.

| Key | Notes |
| --- | --- |
| `calculator` | `expr-eval` — no `eval` |
| `web_search` | DuckDuckGo HTML scrape via `cheerio` |
| `fetch_url` | SSRF-aware fetch + readable text |
| `send_email` | Writes `EmailLog` instead of sending |
| `current_time` | Timezone-aware clock |

Tool failures are returned to the model as tool results so it can recover; only aborted runs throw.

## Guardrails

- Per-agent-step iteration cap (`maxIterations` / `WORKFLOW_MAX_ITERATIONS`)
- Per-run step cap (`WORKFLOW_MAX_STEPS`) against decision loops
- Wall-clock timeout (`WORKFLOW_TIMEOUT_MS`) via `AbortSignal`
- Template interpolation is string substitution only (`{{input}}`, `{{steps.<key>.output}}`)

## Extensibility

**Add a tool:** `src/lib/tools/my-tool.ts` with `defineTool(...)`, append in `registry.ts`. Builder, executor, and LLM schemas pick it up.

**Add a provider:** implement `LLMProvider`, register in `src/lib/llm/index.ts`. The builder greys it out until a key is available.

**Add a step type:** extend Zod/`STEP_TYPES`, add an executor handler, add a builder panel.

## Bonus items covered

Drag-and-drop editor, streaming chat, multiple LLM providers, workflow versioning, execution history, mock email outbox, Docker.

## Deliberate omissions

- **Auth / multi-tenancy** — local single-user demo.
- **Real email delivery** — outbox keeps side effects inspectable and safe for reviewers.
- **SaaS-specific integrations** — prefer generic tools + registries over a long connector list.

## Demo workflows

Seeded by `npm run db:seed` (and Docker `SEED_ON_START`):

1. **Research Assistant** — zero steps (implicit agent), web research + time
2. **Math Tutor** — agent (calculator) → respond
3. **Support Triage** — decision → billing / technical / other; billing may mock-email
