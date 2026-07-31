import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { listRuns } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? 50);

  const runs = await listRuns({
    workflowId,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50,
  });

  return NextResponse.json({ runs });
});
