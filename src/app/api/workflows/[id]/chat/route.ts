import { handle, notFound, parseBody } from "@/lib/api";
import { LLMError } from "@/lib/llm";
import { createSseResponse } from "@/lib/sse";
import { runChatTurn } from "@/lib/workflow/service";
import { chatRequestSchema } from "@/lib/workflow/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// Workflow runs are chains of LLM calls; the default serverless budget is far
// too tight for a multi-step workflow.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;

  const body = await parseBody(request, chatRequestSchema);
  if (!body.ok) return body.response;

  if (!body.data.stream) {
    const result = await runChatTurn({
      workflowId: id,
      message: body.data.message,
      sessionId: body.data.sessionId,
      signal: request.signal,
    });
    return result ? NextResponse.json(result) : notFound("Workflow");
  }

  return createSseResponse(async ({ send, close }) => {
    try {
      const result = await runChatTurn({
        workflowId: id,
        message: body.data.message,
        sessionId: body.data.sessionId,
        signal: request.signal,
        onStarted: (info) => {
          send("started", info);
        },
        onEvent: (event) => {
          send("run_event", event);
        },
        onTextReset: () => {
          send("text_reset", {});
        },
        onTextDelta: (delta) => {
          send("text_delta", { delta });
        },
      });

      if (!result) {
        send("error", { error: "Workflow not found." });
        close();
        return;
      }

      send("done", result);
      close();
    } catch (error) {
      if (request.signal.aborted) {
        close();
        return;
      }
      if (error instanceof LLMError) {
        send("error", { error: error.message });
        close();
        return;
      }
      throw error;
    }
  }, request.signal);
});
