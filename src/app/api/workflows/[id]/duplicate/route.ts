import { NextResponse } from "next/server";

import { handle, notFound } from "@/lib/api";
import { duplicateWorkflow } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const workflow = await duplicateWorkflow(id);
  return workflow ? NextResponse.json({ workflow }, { status: 201 }) : notFound("Workflow");
});
