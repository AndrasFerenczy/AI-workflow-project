import { ToolExecutionError } from "./types";

/** Presenting as a normal browser keeps DuckDuckGo from serving its bot page. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface HttpOptions extends RequestInit {
  /** Per-request budget, independent of the run-level abort signal. */
  timeoutMs?: number;
  /** Refuse to buffer responses larger than this, in bytes. */
  maxBytes?: number;
}

/**
 * fetch with a timeout, a size ceiling and errors phrased so the LLM can act on
 * them. Combines the caller's signal with the timeout so a run-level abort
 * cancels in-flight requests too.
 */
export async function fetchText(
  url: string,
  { timeoutMs = 15_000, maxBytes = 2_000_000, signal, ...init }: HttpOptions = {},
): Promise<{ text: string; contentType: string; finalUrl: string; status: number }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: combined,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        ...init.headers,
      },
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new ToolExecutionError(`Request to ${url} timed out after ${timeoutMs}ms.`);
    }
    throw new ToolExecutionError(
      `Request to ${url} failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  if (!response.ok) {
    throw new ToolExecutionError(
      `Request to ${url} returned HTTP ${response.status} ${response.statusText}.`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) {
    throw new ToolExecutionError(
      `Response from ${url} is ${declaredLength} bytes, larger than the ${maxBytes} byte limit.`,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new ToolExecutionError(
      `Response from ${url} exceeded the ${maxBytes} byte limit.`,
    );
  }

  return {
    text: new TextDecoder("utf-8").decode(buffer),
    contentType: response.headers.get("content-type") ?? "",
    finalUrl: response.url || url,
    status: response.status,
  };
}

/** Rejects anything that is not a plain public http(s) URL. */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolExecutionError(`"${raw}" is not a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolExecutionError(`Only http and https URLs are supported, got "${url.protocol}".`);
  }

  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isLoopback) {
    throw new ToolExecutionError(
      `Refusing to fetch "${host}": private and loopback addresses are blocked.`,
    );
  }

  return url;
}
