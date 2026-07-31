import { NextResponse } from "next/server";

import { handle, notFound } from "@/lib/api";
import { deleteSession, getSessionMessages } from "@/lib/workflow/service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;

  const session = await prisma.chatSession.findUnique({ where: { id } });
  if (!session) return notFound("Session");

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      workflowId: session.workflowId,
    },
    messages: await getSessionMessages(id),
  });
});

export const DELETE = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const deleted = await deleteSession(id);
  return deleted ? NextResponse.json({ ok: true }) : notFound("Session");
});
