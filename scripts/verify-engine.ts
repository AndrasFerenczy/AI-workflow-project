/**
 * Exercises the workflow executor against a scripted OpenAI-compatible server.
 *
 * This covers the parts of the system that are expensive or flaky to test
 * against a real provider: the agent tool-call loop, decision branching,
 * template-driven tool steps, the tool allow-list, and the failure path.
 *
 *   npm run verify:engine
 */
import { createServer } from "node:http";

import { executeWorkflow, type ExecutableWorkflow } from "@/lib/engine/executor";
import { parseStepConfig } from "@/lib/workflow/types";

interface ScriptedReply {
  content: string | null;
  tool_calls?: unknown[];
}

let script: ScriptedReply[] = [];
let callIndex = 0;
const requests: Array<Record<string, any>> = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    requests.push(JSON.parse(body));
    const next = script[callIndex++] ?? { content: "fallback" };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: next.content, tool_calls: next.tool_calls },
            finish_reason: next.tool_calls ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
});

await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as { port: number };
process.env.OPENAI_API_KEY = "sk-verify";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

let failures = 0;

function check(label: string, passed: boolean, detail?: string) {
  if (!passed) failures += 1;
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

const config = (partial: Record<string, unknown> = {}) => parseStepConfig(partial);

function workflow(steps: ExecutableWorkflow["steps"]): ExecutableWorkflow {
  return {
    id: "wf-verify",
    name: "Verification workflow",
    systemPrompt: "You are a test agent.",
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.5,
    maxIterations: 4,
    enabledToolKeys: ["calculator", "send_email"],
    steps,
  };
}

function toolCall(id: string, name: string, args: unknown) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

// --------------------------------------------------------------------------
section("Agent step runs a tool then answers");
script = [
  { content: null, tool_calls: [toolCall("c1", "calculator", { expression: "21*2" })] },
  { content: "The answer is 42." },
];
callIndex = 0;

let result = await executeWorkflow({
  workflow: workflow([]),
  runId: "run-1",
  input: "What is 21 times 2?",
});

check("run succeeds", result.status === "succeeded", result.error);
check("final answer is the model's last text", result.output === "The answer is 42.");
check(
  "tool actually executed",
  result.events.some(
    (event) => event.type === "tool_result" && (event.data as any).summary === "21*2 = 42",
  ),
);
check("usage is accumulated across calls", result.usage.totalTokens === 30);

// --------------------------------------------------------------------------
section("Decision step jumps to the chosen branch and skips the others");
script = [
  {
    content: null,
    tool_calls: [
      toolCall("c2", "select_branch", { branch: "Billing", reason: "Mentions an invoice." }),
    ],
  },
  { content: "Billing handled." },
];
callIndex = 0;

result = await executeWorkflow({
  workflow: workflow([
    {
      key: "triage",
      type: "decision",
      name: "Triage",
      instruction: "Classify: {{input}}",
      toolKey: null,
      config: config({
        branches: [
          { label: "Billing", description: "Invoices and refunds", target: "billing" },
          { label: "Technical", description: "Bugs", target: "technical" },
        ],
      }),
    },
    {
      key: "technical",
      type: "respond",
      name: "Technical reply",
      instruction: "Answer the technical question.",
      toolKey: null,
      config: config(),
    },
    {
      key: "billing",
      type: "respond",
      name: "Billing reply",
      instruction: "Answer the billing question: {{input}}",
      toolKey: null,
      config: config(),
    },
  ]),
  runId: "run-2",
  input: "My invoice is wrong",
});

const visited = result.events
  .filter((event) => event.type === "step_started")
  .map((event) => event.stepKey);

check("chosen branch ran", visited.includes("billing"));
check("unchosen branch was skipped", !visited.includes("technical"));
check("decision recorded in the trace", result.events.some((e) => e.type === "decision"));
check("branch output is the final answer", result.output === "Billing handled.");

// --------------------------------------------------------------------------
section("Template tool step needs no model call, and feeds the next step");
script = [{ content: "Reported." }];
callIndex = 0;
const callsBefore = requests.length;

result = await executeWorkflow({
  workflow: workflow([
    {
      key: "math",
      type: "tool",
      name: "Compute",
      instruction: "",
      toolKey: "calculator",
      config: config({
        argumentMode: "template",
        argumentTemplate: '{"expression": "100+23"}',
      }),
    },
    {
      key: "summary",
      type: "respond",
      name: "Summarise",
      instruction: "Report this result: {{steps.math.output}}",
      toolKey: null,
      config: config(),
    },
  ]),
  runId: "run-3",
  input: "add them",
});

const respondRequest = requests.at(-1)!;
check("template step made no LLM call", requests.length - callsBefore === 1);
check(
  "earlier step output was interpolated",
  String(respondRequest.messages.at(-1).content).includes('"result": 123'),
);
check("respond step is given no tools", respondRequest.tools === undefined);

// --------------------------------------------------------------------------
section("A tool the workflow has switched off cannot be called");
script = [
  { content: null, tool_calls: [toolCall("c3", "web_search", {})] },
  { content: "Answered without search." },
];
callIndex = 0;

result = await executeWorkflow({
  workflow: workflow([]),
  runId: "run-4",
  input: "search something",
});

check(
  "disabled tool is refused",
  result.events.some(
    (event) =>
      event.type === "tool_result" &&
      String((event.data as any).summary).includes("not enabled"),
  ),
);
check("run still recovers", result.output === "Answered without search.");

// --------------------------------------------------------------------------
section("Provider failures are captured, not thrown");
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";

result = await executeWorkflow({ workflow: workflow([]), runId: "run-5", input: "hi" });

check("run is marked failed", result.status === "failed");
check("error is recorded", Boolean(result.error));
check("run_failed event emitted", result.events.some((e) => e.type === "run_failed"));

// --------------------------------------------------------------------------
server.close();
console.log(failures === 0 ? "\nAll engine checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
