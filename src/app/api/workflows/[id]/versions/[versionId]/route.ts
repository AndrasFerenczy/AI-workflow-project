import { NextResponse } from "next/server";

import { handle, notFound } from "@/lib/api";
import { getWorkflowVersion } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; versionId: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  const { id, versionId } = await context.params;
  const version = await getWorkflowVersion(id, versionId);
  return version ? NextResponse.json({ version }) : notFound("Version");
});
