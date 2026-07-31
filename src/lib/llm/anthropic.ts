import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUnion } from "@anthropic-ai/sdk/resources/messages";

import { ensureSettingsLoaded, resolveAnthropicApiKey } from "@/lib/settings";

import {
  LLMError,
  type LLMCompletion,
  type LLMCompletionRequest,
  type LLMMessage,
  type LLMProvider,
  type LLMToolCall,
} from "./types";

const MODELS = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "Balanced default" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fastest" },
  { id: "claude-opus-4-1", label: "Claude Opus 4.1", note: "Most capable" },
];

// Anthropic requires max_tokens on every request, unlike OpenAI.
const DEFAULT_MAX_TOKENS = 4096;

let cached: { key: string; client: Anthropic } | null = null;

async function getClient(): Promise<Anthropic> {
  await ensureSettingsLoaded();
  const apiKey = resolveAnthropicApiKey();
  if (!apiKey) {
    throw new LLMError(
      "Anthropic is not configured. Add a key on the welcome screen or set ANTHROPIC_API_KEY.",
      "anthropic",
    );
  }

  if (cached?.key !== apiKey) {
    cached = { key: apiKey, client: new Anthropic({ apiKey, maxRetries: 2 }) };
  }

  return cached.client;
}

/**
 * Anthropic has no `tool` role: results are user messages carrying
 * tool_result blocks, and consecutive results must be merged into one message.
 */
function toAnthropicMessages(messages: LLMMessage[]): MessageParam[] {
  const out: MessageParam[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        out.push({ role: "user", content: `[System note] ${message.content}` });
        break;

      case "user":
        out.push({ role: "user", content: message.content });
        break;

      case "assistant": {
        const content: Anthropic.ContentBlockParam[] = [];
        if (message.content) content.push({ type: "text", text: message.content });
        for (const call of message.toolCalls ?? []) {
          content.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          });
        }
        if (content.length > 0) out.push({ role: "assistant", content });
        break;
      }

      case "tool": {
        const block: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
          is_error: message.isError ?? false,
        };

        const previous = out.at(-1);
        if (previous?.role === "user" && Array.isArray(previous.content)) {
          previous.content.push(block);
        } else {
          out.push({ role: "user", content: [block] });
        }
        break;
      }
    }
  }

  return out;
}

function buildRequestBody(request: LLMCompletionRequest) {
  const tools: ToolUnion[] | undefined = request.tools?.length
    ? request.tools.map(
        (tool): Tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters as Tool.InputSchema,
        }),
      )
    : undefined;

  const toolChoice = tools
    ? request.toolChoice === "none"
      ? ({ type: "none" } as const)
      : request.toolChoice === "required"
        ? ({ type: "any" } as const)
        : ({ type: "auto" } as const)
    : undefined;

  return {
    model: request.model,
    system: request.system,
    messages: toAnthropicMessages(request.messages),
    temperature: request.temperature,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(tools ? { tools, tool_choice: toolChoice } : {}),
  };
}

function mapError(error: unknown): never {
  if (error instanceof APIError) {
    throw new LLMError(
      `Anthropic request failed (${error.status ?? "network"}): ${error.message}`,
      "anthropic",
      error.status,
    );
  }
  throw error;
}

async function completeBuffered(request: LLMCompletionRequest): Promise<LLMCompletion> {
  const anthropic = await getClient();
  let response;
  try {
    response = await anthropic.messages.create(buildRequestBody(request), {
      signal: request.signal,
    });
  } catch (error) {
    throw mapError(error);
  }

  const textParts: string[] = [];
  const toolCalls: LLMToolCall[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  const text = textParts.join("\n").trim();
  if (text) {
    request.onStreamStart?.();
    request.onTextDelta?.(text);
  }

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    finishReason: response.stop_reason ?? "end_turn",
    model: response.model,
  };
}

async function completeStreaming(request: LLMCompletionRequest): Promise<LLMCompletion> {
  const anthropic = await getClient();
  let stream;
  try {
    stream = anthropic.messages.stream(buildRequestBody(request), {
      signal: request.signal,
    });
  } catch (error) {
    throw mapError(error);
  }

  let started = false;
  const textParts: string[] = [];
  const toolCalls: LLMToolCall[] = [];

  stream.on("text", (delta) => {
    if (!started) {
      started = true;
      request.onStreamStart?.();
    }
    textParts.push(delta);
    request.onTextDelta?.(delta);
  });

  let finalMessage;
  try {
    finalMessage = await stream.finalMessage();
  } catch (error) {
    throw mapError(error);
  }

  for (const block of finalMessage.content) {
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  return {
    text: textParts.join(""),
    toolCalls,
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
    },
    finishReason: finalMessage.stop_reason ?? "end_turn",
    model: finalMessage.model,
  };
}

export const anthropicProvider: LLMProvider = {
  id: "anthropic",
  label: "Anthropic",
  models: MODELS,
  defaultModel: "claude-sonnet-4-5",
  apiKeyEnvVar: "ANTHROPIC_API_KEY",

  isConfigured() {
    return Boolean(resolveAnthropicApiKey());
  },

  async complete(request: LLMCompletionRequest): Promise<LLMCompletion> {
    if (request.onTextDelta || request.onStreamStart) {
      return completeStreaming(request);
    }
    return completeBuffered(request);
  },
};
