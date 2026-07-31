import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { describeProviders } from "@/lib/llm";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  // Recomputed per request so adding a key to .env shows up without a rebuild.
  return NextResponse.json({ providers: await describeProviders() });
});
