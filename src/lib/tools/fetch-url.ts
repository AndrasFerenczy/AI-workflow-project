import * as cheerio from "cheerio";
import { z } from "zod";

import { defineTool } from "./define";
import { assertPublicHttpUrl, fetchText } from "./http";
import { ToolExecutionError } from "./types";

const parameters = z.object({
  url: z.string().min(1).describe("Absolute http(s) URL of the page to read."),
  maxChars: z
    .number()
    .int()
    .min(500)
    .max(20_000)
    .default(6_000)
    .describe("Truncate the extracted text to this many characters (default 6000)."),
});

/** Strips chrome and boilerplate so the model spends its context on prose. */
function extractReadableText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas, form, nav, header, footer, aside, " +
      "[aria-hidden='true'], .nav, .navbar, .menu, .sidebar, .footer, .header, .cookie, .ad",
  ).remove();

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "Untitled";

  const root = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");

  const text = root
    .text()
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return { title, text };
}

export const fetchUrlTool = defineTool({
  key: "fetch_url",
  name: "Fetch URL",
  description:
    "Download a web page and return its readable text content. Use it after web_search " +
    "when a snippet is not enough, or whenever the user gives you a link to read.",
  summary: "Reads a page and strips it down to plain text.",
  icon: "Globe",
  tags: ["network"],
  // Paired with web_search in the builder as “Web research”.
  enabledByDefault: true,
  parameters,
  async execute({ url, maxChars }, context) {
    const target = assertPublicHttpUrl(url);

    const { text: body, contentType, finalUrl } = await fetchText(target.toString(), {
      signal: context.signal,
      timeoutMs: 20_000,
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    });

    if (contentType && !/text\/|json|xml/i.test(contentType)) {
      throw new ToolExecutionError(
        `${finalUrl} returned "${contentType}", which is not readable as text.`,
      );
    }

    const isHtml = /html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
    const { title, text } = isHtml
      ? extractReadableText(body)
      : { title: finalUrl, text: body.trim() };

    if (!text) {
      throw new ToolExecutionError(
        `${finalUrl} had no extractable text. It may be a JavaScript-only page.`,
      );
    }

    const truncated = text.length > maxChars;

    return {
      url: finalUrl,
      title,
      truncated,
      charCount: text.length,
      content: truncated ? `${text.slice(0, maxChars)}\n\n[truncated]` : text,
    };
  },
  summarize: (_input, output) =>
    `${output.title} (${output.charCount.toLocaleString()} chars${output.truncated ? ", truncated" : ""})`,
});
