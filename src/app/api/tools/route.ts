import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { describeTools } from "@/lib/tools/registry";

export const GET = handle(async () => {
  return NextResponse.json({ tools: describeTools() });
});
