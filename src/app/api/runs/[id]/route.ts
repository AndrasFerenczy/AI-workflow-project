import { NextResponse } from "next/server";

import { handle, notFound } from "@/lib/api";
import { getRun } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const run = await getRun(id);
  return run ? NextResponse.json({ run }) : notFound("Run");
});
