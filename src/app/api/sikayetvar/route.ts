import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { fetchAndStoreSikayetvarComplaints } from "@/lib/sikayetvar/scraper";

const NEW_COMPLAINT_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  { isNew: "desc" },
  { firstSeenAt: "asc" },
],
    });

    const now = Date.now();

    const sortedComplaints = [...complaints].sort((a, b) => {
      const aTime = a.firstSeenAt.getTime();
      const bTime = b.firstSeenAt.getTime();

      const aIsNew = aTime > now - NEW_COMPLAINT_WINDOW_MS;
      const bIsNew = bTime > now - NEW_COMPLAINT_WINDOW_MS;

      if (aIsNew && !bIsNew) return -1;
      if (!aIsNew && bIsNew) return 1;

      return aTime - bTime;
    });

    return NextResponse.json({ data: sortedComplaints });
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
      notify: false,
      duplicateMode: "url",
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
