/**
 * Minimal Server-Sent Events helpers for the chat stream.
 */

export type SseWriter = {
  send: (event: string, data: unknown) => void;
  close: () => void;
  response: Response;
};

export function createSseResponse(
  run: (writer: Omit<SseWriter, "response">) => Promise<void>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const onAbort = () => close();
      signal?.addEventListener("abort", onAbort);

      try {
        await run({ send, close });
      } catch (error) {
        if (!closed && !signal?.aborted) {
          const message =
            error instanceof Error ? error.message : "An unexpected error occurred.";
          send("error", { error: message });
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
