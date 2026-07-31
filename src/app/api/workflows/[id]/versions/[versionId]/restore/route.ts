import { NextResponse } from "next/server";

import { handle, notFound } from "@/lib/api";
import { restoreWorkflowVersion } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; versionId: string }> };

export const POST = handle(async (_request: Request, context: Context) => {
  const { id, versionId } = await context.params;
  const workflow = await restoreWorkflowVersion(id, versionId);
  return workflow ? NextResponse.json({ workflow }) : notFound("Version");
});
