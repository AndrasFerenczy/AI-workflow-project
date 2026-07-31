import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { listEmails } from "@/lib/workflow/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  return NextResponse.json({ emails: await listEmails() });
});
