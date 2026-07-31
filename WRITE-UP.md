# Architecture & Design Decisions

## Stack

The entire application is a single Next.js 16 project. The UI, API routes, workflow engine, and database layer all live in one TypeScript codebase, which means every layer shares the same types and Zod validation schemas. In production, it runs as one Docker container with a SQLite database on a named volume.

## How a Chat Turn Works

A user builds a workflow in the visual editor by configuring a system prompt, choosing a model and provider, enabling tools, and arranging steps with drag-and-drop. When the user sends a message in the chat view, the following happens:

1. The API loads the workflow configuration and the session's conversation history.
2. A `Run` record is created to track this execution.
3. The executor walks through the step list in order. For each step it calls the LLM, invokes tools, or evaluates decision branches as needed.
4. Every action — LLM calls, tool invocations, branch decisions — is appended to an ordered event trace (`RunEvent`), which serves as the single source of truth for what happened.
5. The assistant's reply streams to the browser over SSE, and the full trace is persisted when the run completes.

The chat UI displays the reply with a collapsible execution trace underneath, so the user can inspect exactly what the model did at each step.

## Step Types

Four step types cover sequential pipelines and simple decision flows:

- **Agent** — an LLM ↔ tool loop where the model can call any of the step's enabled tools, bounded by a configurable iteration cap.
- **Tool** — always runs one specific tool, with arguments provided by the LLM or a JSON template.
- **Decision** — the LLM picks from a set of labelled branches, and the engine jumps to the corresponding step.
- **Respond** — composes the final user-facing answer from the context gathered by earlier steps.

Workflows with no steps configured fall back to a single implicit agent step, so simple configurations like the Research Assistant demo work without any step setup at all.

## Design Decisions

**Registry pattern for extensibility.** Tools live in `src/lib/tools/` and LLM providers in `src/lib/llm/`. Both use a registry array — the executor and UI only interact through the registry interface. Adding a new tool or provider means writing one file and appending it to the array; nothing else in the app changes.

**Provider-neutral message format.** Internally, the app uses a single `LLMMessage` type. Each provider adapter (OpenAI-compatible, Anthropic) translates to and from its vendor-specific format, so the executor never needs to branch on which provider is in use.

**Append-only event trace.** The executor only appends to a `RunEventCollector`. Both the database persistence layer and the API response read from this same collector, which guarantees the UI trace always matches what actually ran.

**Resilient tool execution.** When a tool fails, the error is returned to the model as a tool result rather than crashing the run. This lets the model recover — it can fix its arguments, try a different approach, or explain the failure to the user.

**API key resolution.** Keys can be entered through the in-app welcome screen or Settings page (stored in SQLite), or set via `.env` for Docker deployments. The database value takes priority when present; the environment variable serves as a fallback.

**Guardrails.** Three safety limits prevent runaway execution: an iteration cap per agent step (`WORKFLOW_MAX_ITERATIONS`), a total step cap per run (`WORKFLOW_MAX_STEPS`), and a wall-clock timeout (`WORKFLOW_TIMEOUT_MS`) enforced via `AbortSignal`.

## Data Model

- **Workflow** — the top-level configuration: system prompt, provider, model, and iteration budget.
- **WorkflowStep** — ordered nodes with a stable `key` used for template references (`{{steps.<key>.output}}`) and decision branch targets.
- **WorkflowTool** — per-workflow tool enable/disable flags.
- **WorkflowVersion** — an immutable snapshot created on every save, supporting version history and restore.
- **ChatSession / Message** — conversation memory, kept separate from execution traces.
- **Run / RunEvent** — execution history with the full ordered trace of each run.
- **EmailLog** — mock email outbox for the `send_email` tool.
- **AppSetting** — API key overrides and setup completion state.
