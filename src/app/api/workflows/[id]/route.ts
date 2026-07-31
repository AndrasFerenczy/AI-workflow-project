import { NextResponse } from "next/server";

import { handle, jsonError, notFound, parseBody } from "@/lib/api";
import { isProviderId } from "@/lib/llm";
import { isKnownToolKey } from "@/lib/tools/registry";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/lib/workflow/service";
import { updateWorkflowSchema, validateSteps } from "@/lib/workflow/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const workflow = await getWorkflow(id);
  return workflow ? NextResponse.json({ workflow }) : notFound("Workflow");
});

export const PUT = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;

  const body = await parseBody(request, updateWorkflowSchema);
  if (!body.ok) return body.response;

  if (!isProviderId(body.data.provider)) {
    return jsonError(`Unknown provider "${body.data.provider}".`, 400);
  }

  const unknownTool = body.data.tools.find((tool) => !isKnownToolKey(tool.toolKey));
  if (unknownTool) {
    return jsonError(`Unknown tool "${unknownTool.toolKey}".`, 400);
  }

  const unknownStepTool = body.data.steps.find(
    (step) => step.toolKey && !isKnownToolKey(step.toolKey),
  );
  if (unknownStepTool) {
    return jsonError(`Step "${unknownStepTool.name}" references an unknown tool.`, 400);
  }

  // Cross-field rules the schema cannot express: unique keys, decision targets.
  const stepErrors = validateSteps(body.data.steps);
  if (stepErrors.length > 0) {
    return jsonError("The workflow steps are not valid.", 400, stepErrors);
  }

  const workflow = await updateWorkflow(id, body.data);
  return workflow ? NextResponse.json({ workflow }) : notFound("Workflow");
});

export const DELETE = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const deleted = await deleteWorkflow(id);
  return deleted ? NextResponse.json({ ok: true }) : notFound("Workflow");
});
