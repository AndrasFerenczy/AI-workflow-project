import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

import { LLMError } from "@/lib/llm";

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json<ApiErrorBody>({ error: message, details }, { status });
}

export function notFound(what = "Resource") {
  return jsonError(`${what} not found.`, 404);
}

/** Parses and validates a JSON request body, returning a 400 response on failure. */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError("Request body must be valid JSON.", 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError("Validation failed.", 400, formatIssues(parsed.error)) };
  }

  return { ok: true, data: parsed.data };
}

export function formatIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/**
 * Wraps a handler so unexpected throws become a 500 with a logged stack, and
 * provider misconfiguration becomes an actionable 400 instead.
 */
export function handle<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof LLMError) {
        return jsonError(error.message, 400);
      }
      if (error instanceof ZodError) {
        return jsonError("Validation failed.", 400, formatIssues(error));
      }

      console.error("[api] unhandled error", error);
      const message =
        error instanceof Error ? error.message : "An unexpected error occurred.";
      return jsonError(message, 500);
    }
  };
}
