import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const notifications = await prisma.notification.findMany({
    where: {
      isRead: false,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 50,
  });

  return NextResponse.json({
    data: notifications,
  });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body?.clearAll === true) {
    await prisma.notification.updateMany({
      where: {
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return NextResponse.json({ success: true });
  }

  if (body?.id) {
    await prisma.notification.updateMany({
      where: {
        id: String(body.id),
      },
      data: {
        isRead: true,
      },
    });
  }

  return NextResponse.json({ success: true });
}
