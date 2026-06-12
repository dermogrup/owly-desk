import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { emitNewMessage } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "messages:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(messages);
  } catch (error) {
    logger.error("Failed to fetch messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "messages:create");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { content, role } = body;

    const trimmedContent = typeof content === "string" ? content.trim() : "";

    if (!trimmedContent) {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const validRoles = ["customer", "assistant", "admin", "system"];
    const messageRole = validRoles.includes(role) ? role : "admin";

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        role: messageRole,
        content: trimmedContent,
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Dispatch message to corresponding channel if it is outbound.
    // Conversations UI sends role="admin", AI sends role="assistant".
    if (messageRole === "assistant" || messageRole === "admin") {
      const channel = conversation.channel;
      const contact = conversation.customerContact;

      try {
        if (channel === "whatsapp") {
          const { sendWhatsAppMessage } = await import("@/lib/channels/whatsapp");

          logger.info(`[API] Sending WhatsApp message to ${contact}`);

          const sent = await sendWhatsAppMessage(contact, trimmedContent);

          if (!sent) {
            logger.error(`[API] WhatsApp message failed to send to ${contact}`);
          }
        } else if (channel === "sms") {
          const { sendSms } = await import("@/lib/channels/sms");
          await sendSms(contact, trimmedContent);
        } else if (channel === "email") {
          const { sendEmail } = await import("@/lib/channels/email");
          await sendEmail(contact, "Support Update", trimmedContent);
        } else if (channel === "telegram") {
          const { sendTelegram } = await import("@/lib/channels/telegram");
          await sendTelegram(contact, trimmedContent);
        }
      } catch (dispatchError) {
        logger.error(
          `[API] Failed to dispatch outbound message to ${channel}:`,
          dispatchError
        );
      }
    }

    emitNewMessage(id, {
      id: message.id,
      role: messageRole,
      content: trimmedContent,
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    logger.error("Failed to create message:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}