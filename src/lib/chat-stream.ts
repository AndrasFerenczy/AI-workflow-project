import type { RunEvent } from "@/lib/engine/events";
import type { ChatResponseDTO, MessageDTO } from "@/lib/workflow/dto";
import { ApiError } from "@/lib/client";

export type ChatStreamHandlers = {
  onStarted?: (info: {
    sessionId: string;
    runId: string;
    userMessage: MessageDTO;
  }) => void;
  onEvent?: (event: RunEvent) => void;
  onTextReset?: () => void;
  onTextDelta?: (delta: string) => void;
  onDone?: (result: ChatResponseDTO) => void;
  onError?: (message: string) => void;
};

/**
 * POSTs a chat turn with `stream: true` and dispatches SSE events to handlers.
 */
export async function streamChatTurn(
  workflowId: string,
  body: { message: string; sessionId?: string | null },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/workflows/${workflowId}/chat`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status);
  }

  if (!response.body) {
    throw new ApiError("No response body from chat stream.", 500);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const lines = chunk.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;

      let data: unknown = null;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }

      switch (eventName) {
        case "started":
          handlers.onStarted?.(
            data as {
              sessionId: string;
              runId: string;
              userMessage: MessageDTO;
            },
          );
          break;
        case "run_event":
          handlers.onEvent?.(data as RunEvent);
          break;
        case "text_reset":
          handlers.onTextReset?.();
          break;
        case "text_delta":
          handlers.onTextDelta?.((data as { delta: string }).delta);
          break;
        case "done":
          sawDone = true;
          handlers.onDone?.(data as ChatResponseDTO);
          break;
        case "error":
          handlers.onError?.((data as { error: string }).error);
          break;
      }
    }
  }

  if (!sawDone && !signal?.aborted) {
    handlers.onError?.("The stream ended before the run finished.");
  }
}
