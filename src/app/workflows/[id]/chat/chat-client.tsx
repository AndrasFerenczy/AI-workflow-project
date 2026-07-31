"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  MessageSquarePlus,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownContent } from "@/components/markdown-content";
import { RunTrace } from "@/components/run-trace";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Badge, EmptyState, Spinner } from "@/components/ui/primitives";
import { streamChatTurn } from "@/lib/chat-stream";
import { ApiError, apiGet, apiSend } from "@/lib/client";
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils";
import type {
  MessageDTO,
  RunDetailDTO,
  SessionSummaryDTO,
  WorkflowDTO,
} from "@/lib/workflow/dto";

interface LocalMessage extends MessageDTO {
  run?: RunDetailDTO | null;
  pending?: boolean;
  streaming?: boolean;
  error?: string | null;
}

export default function ChatClient() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;

  const [workflow, setWorkflow] = useState<WorkflowDTO | null>(null);
  const [sessions, setSessions] = useState<SessionSummaryDTO[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(() => new Set());
  const [pendingSessionDelete, setPendingSessionDelete] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadWorkflowAndSessions = useCallback(async () => {
    try {
      const [workflowRes, sessionsRes] = await Promise.all([
        apiGet<{ workflow: WorkflowDTO }>(`/api/workflows/${workflowId}`),
        apiGet<{ sessions: SessionSummaryDTO[] }>(
          `/api/workflows/${workflowId}/sessions`,
        ),
      ]);
      setWorkflow(workflowRes.workflow);
      setSessions(sessionsRes.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat.");
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  const loadSession = useCallback(async (id: string) => {
    try {
      const data = await apiGet<{ messages: MessageDTO[] }>(`/api/sessions/${id}`);

      const withRuns: LocalMessage[] = await Promise.all(
        data.messages.map(async (message) => {
          if (!message.runId) return message;
          try {
            const runRes = await apiGet<{ run: RunDetailDTO }>(
              `/api/runs/${message.runId}`,
            );
            return { ...message, run: runRes.run };
          } catch {
            return message;
          }
        }),
      );
      setMessages(withRuns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session.");
    }
  }, []);

  useEffect(() => {
    void loadWorkflowAndSessions();
  }, [loadWorkflowAndSessions]);

  useEffect(() => {
    // While a turn is in flight, onStarted may assign a brand-new sessionId.
    // Reloading then would replace optimistic bubbles with the DB snapshot
    // (user message only) and drop the streaming assistant message.
    if (sending) return;
    if (sessionId) {
      void loadSession(sessionId);
    } else {
      setMessages([]);
    }
  }, [sessionId, loadSession, sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  function startNewChat() {
    setSessionId(null);
    setMessages([]);
    setError(null);
  }

  async function confirmDeleteSession() {
    if (!pendingSessionDelete) return;
    setDeletingSession(true);
    try {
      await apiSend(`/api/sessions/${pendingSessionDelete}`, "DELETE");
      setSessions((current) =>
        current.filter((session) => session.id !== pendingSessionDelete),
      );
      if (sessionId === pendingSessionDelete) startNewChat();
      setPendingSessionDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session.");
    } finally {
      setDeletingSession(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setInput("");

    const optimisticId = `local_${crypto.randomUUID()}`;
    const pendingId = `${optimisticId}_pending`;
    // Tracks the user bubble id after `onStarted` swaps the optimistic local id
    // for the persisted message id — needed so `onDone` can remove it cleanly.
    let userBubbleId = optimisticId;

    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "user",
        content: text,
        runId: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: pendingId,
        role: "assistant",
        content: "",
        runId: null,
        createdAt: new Date().toISOString(),
        pending: true,
        streaming: true,
      },
    ]);

    const patchPending = (patch: Partial<LocalMessage> | ((msg: LocalMessage) => LocalMessage)) => {
      setMessages((current) =>
        current.map((entry) => {
          if (entry.id !== pendingId) return entry;
          return typeof patch === "function" ? patch(entry) : { ...entry, ...patch };
        }),
      );
    };

    try {
      await streamChatTurn(
        workflowId,
        { message: text, sessionId },
        {
          onStarted: (info) => {
            setSessionId(info.sessionId);
            userBubbleId = info.userMessage.id;
            setMessages((current) =>
              current.map((entry) =>
                entry.id === optimisticId ? { ...info.userMessage } : entry,
              ),
            );
            patchPending({ runId: info.runId });
            setSessions((current) => {
              const existing = current.find((session) => session.id === info.sessionId);
              if (existing) {
                return [
                  {
                    ...existing,
                    updatedAt: new Date().toISOString(),
                    messageCount: existing.messageCount + 1,
                  },
                  ...current.filter((session) => session.id !== info.sessionId),
                ];
              }
              return [
                {
                  id: info.sessionId,
                  title: text.slice(0, 60),
                  messageCount: 1,
                  updatedAt: new Date().toISOString(),
                },
                ...current,
              ];
            });
          },
          onTextReset: () => {
            patchPending({ content: "", pending: false, streaming: true });
          },
          onTextDelta: (delta) => {
            patchPending((msg) => ({
              ...msg,
              pending: false,
              streaming: true,
              content: `${msg.content}${delta}`,
            }));
          },
          onDone: (data) => {
            setSessionId(data.sessionId);
            setMessages((current) => {
              const withoutTurn = current.filter(
                (message) =>
                  message.id !== optimisticId &&
                  message.id !== pendingId &&
                  message.id !== userBubbleId &&
                  message.id !== data.userMessage.id,
              );
              return [
                ...withoutTurn,
                data.userMessage,
                { ...data.assistantMessage, run: data.run },
              ];
            });
            setSessions((current) => {
              const existing = current.find((session) => session.id === data.sessionId);
              if (existing) {
                return [
                  {
                    ...existing,
                    updatedAt: new Date().toISOString(),
                    messageCount: Math.max(existing.messageCount + 1, 2),
                  },
                  ...current.filter((session) => session.id !== data.sessionId),
                ];
              }
              return [
                {
                  id: data.sessionId,
                  title: text.slice(0, 60),
                  messageCount: 2,
                  updatedAt: new Date().toISOString(),
                },
                ...current,
              ];
            });
          },
          onError: (message) => {
            patchPending((entry) => ({
              ...entry,
              pending: false,
              streaming: false,
              error: message,
              content: entry.content || "The run failed.",
            }));
            setError(message);
          },
        },
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Chat failed.";
      patchPending((entry) => ({
        ...entry,
        pending: false,
        streaming: false,
        error: message,
        content: entry.content || "The run failed.",
      }));
      setError(message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <EmptyState
          title="Workflow not found"
          description={error ?? undefined}
          action={
            <Link href="/">
              <Button variant="secondary">Back</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-7xl animate-fade-in">
      <ConfirmDialog
        open={pendingSessionDelete != null}
        title="Delete this chat?"
        description="The conversation will be removed. Past runs stay in History."
        busy={deletingSession}
        onCancel={() => setPendingSessionDelete(null)}
        onConfirm={() => void confirmDeleteSession()}
      />
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface/40">
        <div className="space-y-3 border-b border-border p-4">
          <Link
            href={`/workflows/${workflow.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-subtle hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Edit workflow
          </Link>
          <div>
            <p className="truncate text-sm font-semibold">{workflow.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-subtle">
              {workflow.provider} · {workflow.model}
            </p>
          </div>
          <Button size="sm" variant="primary" className="w-full" onClick={startNewChat}>
            <MessageSquarePlus className="size-3.5" />
            New chat
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-subtle">No chats yet.</p>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group flex items-center gap-1 rounded-xl px-2 py-2",
                  sessionId === session.id ? "bg-accent-soft" : "hover:bg-surface-raised",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSessionId(session.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm">{session.title}</p>
                  <p className="text-[11px] text-subtle">
                    {formatRelativeTime(session.updatedAt)}
                  </p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 opacity-0 group-hover:opacity-100"
                  aria-label="Delete session"
                  onClick={() => setPendingSessionDelete(session.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h1 className="text-sm font-semibold">Chat</h1>
          </div>
          <Link href={`/workflows/${workflow.id}`}>
            <Button size="sm" variant="ghost">
              <Pencil className="size-3.5" />
              Builder
            </Button>
          </Link>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
          {messages.length === 0 ? (
            <EmptyState
              title={`Chat with ${workflow.name}`}
              description="Ask something. The workflow runs its configured steps; open tool calls on a reply to inspect the trace."
            />
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "animate-slide-up flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[min(42rem,92%)] space-y-3 rounded-2xl px-4 py-3",
                    message.role === "user"
                      ? "bg-accent text-accent-foreground"
                      : "border border-border bg-surface",
                  )}
                >
                  {message.pending && !message.content ? (
                    <div className="flex items-center gap-2 text-sm text-subtle">
                      <Spinner />
                      <span className="animate-pulse-soft">Running workflow…</span>
                    </div>
                  ) : message.role === "assistant" ? (
                    <div>
                      {message.content ? (
                        message.streaming ? (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">
                            {message.content}
                            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse-soft rounded-sm bg-accent align-middle" />
                          </p>
                        ) : (
                          <MarkdownContent content={message.content} />
                        )
                      ) : message.streaming ? (
                        <div className="flex items-center gap-2 text-sm text-subtle">
                          <Spinner />
                          <span className="animate-pulse-soft">Thinking…</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </p>
                  )}

                  {message.error ? (
                    <p className="text-xs text-danger">{message.error}</p>
                  ) : null}

                  {message.run ? (
                    <div className="space-y-2 border-t border-border pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            message.run.status === "succeeded"
                              ? "success"
                              : message.run.status === "failed"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {message.run.status}
                        </Badge>
                        <Badge tone="neutral">
                          {formatDuration(message.run.durationMs)}
                        </Badge>
                        {message.run.toolCallCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedTraces((current) => {
                                const next = new Set(current);
                                if (next.has(message.id)) next.delete(message.id);
                                else next.add(message.id);
                                return next;
                              });
                            }}
                            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Badge tone={expandedTraces.has(message.id) ? "accent" : "info"}>
                              {message.run.toolCallCount} tool call
                              {message.run.toolCallCount === 1 ? "" : "s"}
                            </Badge>
                          </button>
                        ) : null}
                        <Link
                          href={`/runs/${message.run.id}`}
                          className="text-[11px] text-subtle hover:text-foreground"
                        >
                          Open run
                        </Link>
                      </div>
                      {expandedTraces.has(message.id) ? (
                        <RunTrace events={message.run.events} showHeader={false} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(event) => void onSubmit(event)}
          className="border-t border-border bg-surface/60 p-4"
        >
          {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
          <div className="flex items-end gap-3">
            <Textarea
              rows={2}
              value={input}
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message the workflow…"
              className="min-h-[3rem] flex-1"
            />
            <Button type="submit" variant="primary" loading={sending} disabled={!input.trim()}>
              <Send className="size-4" />
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
