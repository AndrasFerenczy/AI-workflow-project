import { NextResponse } from "next/server";

import { handle, notFound } from "@/lib/api";
import { getWorkflow, listSessions } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;

  const workflow = await getWorkflow(id);
  if (!workflow) return notFound("Workflow");

  return NextResponse.json({ sessions: await listSessions(id) });
});
