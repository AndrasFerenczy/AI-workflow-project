import * as cheerio from "cheerio";
import { z } from "zod";

import { defineTool } from "./define";
import { fetchText } from "./http";
import { ToolExecutionError } from "./types";

const parameters = z.object({
  query: z
    .string()
    .min(2, "query is too short")
    .max(300, "query is too long")
    .describe("The search query. Prefer specific, keyword-rich phrasing."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many results to return (1-10, default 5)."),
});

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchBackend {
  id: string;
  label: string;
  run(query: string, limit: number, signal: AbortSignal): Promise<SearchResult[]>;
}

/**
 * DuckDuckGo sometimes wraps outbound links in a redirector
 * (//duckduckgo.com/l/?uddg=<encoded target>). Unwrap it so the model and the
 * fetch_url tool get a real address.
 */
function unwrapRedirect(href: string | undefined): string | null {
  if (!href) return null;

  const absolute = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(absolute, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    if (target) return target;
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return null;
  } catch {
    return null;
  }
}

function collect(
  raw: Array<{ title: string; href: string | undefined | null; snippet: string }>,
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (results.length >= limit) break;
    const url = unwrapRedirect(entry.href ?? undefined);
    const title = entry.title.trim().replace(/\s+/g, " ");
    if (!title || !url || seen.has(url)) continue;

    seen.add(url);
    results.push({ title, url, snippet: entry.snippet.trim().replace(/\s+/g, " ") });
  }

  return results;
}

class RateLimitedError extends Error {}

async function duckDuckGoHtml(
  url: string,
  query: string,
  signal: AbortSignal,
): Promise<cheerio.CheerioAPI> {
  const { text } = await fetchText(url, {
    method: "POST",
    body: new URLSearchParams({ q: query, kl: "wt-wt" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
    timeoutMs: 12_000,
  });

  // The anti-bot challenge comes back as a normal 200/202 page, so it has to be
  // detected by content rather than status.
  if (/anomaly-modal|unusual traffic|challenge-form|blocked because/i.test(text)) {
    throw new RateLimitedError("DuckDuckGo served an anti-bot challenge.");
  }

  return cheerio.load(text);
}

const ddgHtmlBackend: SearchBackend = {
  id: "duckduckgo_html",
  label: "DuckDuckGo",
  async run(query, limit, signal) {
    const $ = await duckDuckGoHtml("https://html.duckduckgo.com/html/", query, signal);
    const raw: Array<{ title: string; href: string | undefined; snippet: string }> = [];

    $("div.result").each((_, element) => {
      const node = $(element);
      if (node.hasClass("result--ad") || node.find(".badge--ad").length > 0) return;

      const anchor = node.find("a.result__a").first();
      raw.push({
        title: anchor.text(),
        href: anchor.attr("href"),
        snippet: node.find(".result__snippet").first().text(),
      });
    });

    return collect(raw, limit);
  },
};

const ddgLiteBackend: SearchBackend = {
  id: "duckduckgo_lite",
  label: "DuckDuckGo Lite",
  async run(query, limit, signal) {
    const $ = await duckDuckGoHtml("https://lite.duckduckgo.com/lite/", query, signal);
    const raw: Array<{ title: string; href: string | undefined; snippet: string }> = [];

    $("a.result-link").each((_, element) => {
      const anchor = $(element);
      // Title and snippet sit in sibling rows of the same results table.
      const snippet = anchor.closest("tr").next("tr").find("td.result-snippet").text();
      raw.push({ title: anchor.text(), href: anchor.attr("href"), snippet });
    });

    return collect(raw, limit);
  },
};

/** Official, key-free API. Rich for entities and definitions, empty otherwise. */
const ddgInstantAnswerBackend: SearchBackend = {
  id: "duckduckgo_instant_answer",
  label: "DuckDuckGo Instant Answer",
  async run(query, limit, signal) {
    const { text } = await fetchText(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal, timeoutMs: 10_000 },
    );

    const payload = JSON.parse(text) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const raw: Array<{ title: string; href: string | undefined; snippet: string }> = [];

    if (payload.AbstractText && payload.AbstractURL) {
      raw.push({
        title: payload.Heading || query,
        href: payload.AbstractURL,
        snippet: payload.AbstractText,
      });
    }

    for (const topic of payload.RelatedTopics ?? []) {
      if (!topic.Text || !topic.FirstURL) continue;
      const [head, ...rest] = topic.Text.split(" - ");
      raw.push({
        title: head,
        href: topic.FirstURL,
        snippet: rest.join(" - ") || topic.Text,
      });
    }

    return collect(raw, limit);
  },
};

/**
 * Last resort. Not a general web index, but it is an official API that never
 * rate-limits us, so an encyclopaedic answer beats no answer at all.
 */
const wikipediaBackend: SearchBackend = {
  id: "wikipedia",
  label: "Wikipedia",
  async run(query, limit, signal) {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(limit),
      format: "json",
      origin: "*",
    });

    const { text } = await fetchText(`https://en.wikipedia.org/w/api.php?${params}`, {
      signal,
      timeoutMs: 10_000,
    });

    const payload = JSON.parse(text) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };

    return collect(
      (payload.query?.search ?? []).map((item) => ({
        title: item.title,
        href: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
        snippet: item.snippet.replace(/<[^>]+>/g, ""),
      })),
      limit,
    );
  },
};

// Ordered best-first. Scraped endpoints give real web results; the official
// APIs below them keep the tool useful when DuckDuckGo throttles this IP.
const BACKENDS: SearchBackend[] = [
  ddgHtmlBackend,
  ddgLiteBackend,
  ddgInstantAnswerBackend,
  wikipediaBackend,
];

export const webSearchTool = defineTool({
  key: "web_search",
  name: "Web search",
  description:
    "Search the public web and get back a ranked list of titles, URLs and snippets. " +
    "Use it for anything current, factual or outside your training data. Snippets are " +
    "short, so follow up with fetch_url when you need the full text of a page.",
  summary: "Live DuckDuckGo results with Wikipedia fallback. No API key required.",
  icon: "Search",
  tags: ["network"],
  enabledByDefault: true,
  parameters,
  async execute({ query, limit }, context) {
    let rateLimited = false;
    let lastError: string | null = null;

    for (const backend of BACKENDS) {
      try {
        const results = await backend.run(query, limit, context.signal);
        if (results.length > 0) {
          return {
            query,
            source: backend.label,
            degraded: backend.id === "wikipedia",
            resultCount: results.length,
            results,
          };
        }
      } catch (error) {
        if (context.signal.aborted) throw error;
        if (error instanceof RateLimitedError) {
          rateLimited = true;
          continue;
        }
        lastError = error instanceof Error ? error.message : "request failed";
      }
    }

    throw new ToolExecutionError(
      rateLimited
        ? `No results for "${query}". DuckDuckGo is currently rate-limiting this machine ` +
          "and the fallback sources had nothing. Answer from what you already know and " +
          "tell the user that web search was unavailable."
        : lastError
          ? `Search for "${query}" failed: ${lastError}`
          : `No results found for "${query}". Try different or broader keywords.`,
    );
  },
  summarize: (input, output) =>
    `"${input.query}" - ${output.resultCount} result${output.resultCount === 1 ? "" : "s"} via ${output.source}`,
});
