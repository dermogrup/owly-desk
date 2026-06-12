import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "conversations:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { id } = await params;
    const complaint = await prisma.sikayetvarComplaint.findUnique({ where: { id } });

    if (!complaint) {
      return NextResponse.json({ error: "Şikayet bulunamadı" }, { status: 404 });
    }

    return NextResponse.json(complaint);
  } catch (error) {
    logger.error("[Şikayetvar] Failed to get complaint", error);
    return NextResponse.json({ error: "Şikayet yüklenemedi" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "conversations:update");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { id } = await params;
    const body = await request.json();

    const complaint = await prisma.sikayetvarComplaint.update({
      where: { id },
      data: {
        ...(typeof body.answered === "boolean" && { answered: body.answered }),
      },
    });

    return NextResponse.json(complaint);
  } catch (error) {
    logger.error("[Şikayetvar] Failed to update complaint", error);
    return NextResponse.json({ error: "Şikayet güncellenemedi" }, { status: 500 });
  }
}
