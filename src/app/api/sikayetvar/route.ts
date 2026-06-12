import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { fetchAndStoreSikayetvarComplaints } from "@/lib/sikayetvar/scraper";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "conversations:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const status = request.nextUrl.searchParams.get("status") || "all";
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";

    const complaints = await prisma.sikayetvarComplaint.findMany({
      where: {
        ...(status === "answered" && { answered: true }),
        ...(status === "pending" && { answered: false }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { content: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: [
        { pageNumber: "asc" },
        { firstSeenAt: "asc" },
      ],
    });

    return NextResponse.json({ data: complaints });
  } catch (error) {
    logger.error("[Şikayetvar] Failed to list complaints", error);
    return NextResponse.json(
      { error: "Şikayetvar şikayetleri yüklenemedi" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "conversations:update");
  if (!isAuthenticated(auth)) return auth;

  try {
const body = await request.json().catch(() => ({}));

const result = await fetchAndStoreSikayetvarComplaints({
  ...(Number.isInteger(body.maxPages) && { maxPages: body.maxPages }),
  fetchDetails: true,
});

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("[Şikayetvar] Manual sync failed", error);
    return NextResponse.json(
      { error: "Şikayetvar senkronizasyonu başarısız" },
      { status: 500 }
    );
  }
}
