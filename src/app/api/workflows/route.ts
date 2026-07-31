import { NextResponse } from "next/server";

import { handle, parseBody } from "@/lib/api";
import { createWorkflow, listWorkflows } from "@/lib/workflow/service";
import { createWorkflowSchema } from "@/lib/workflow/types";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  return NextResponse.json({ workflows: await listWorkflows() });
});

export const POST = handle(async (request: Request) => {
  const body = await parseBody(request, createWorkflowSchema);
  if (!body.ok) return body.response;

  const workflow = await createWorkflow({
    name: body.data.name,
    description: body.data.description,
    systemPrompt: body.data.systemPrompt,
    provider: body.data.provider,
    model: body.data.model,
  });

  return NextResponse.json({ workflow }, { status: 201 });
});
