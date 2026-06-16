import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import {
  startEmailListener,
  stopEmailListener,
  getEmailStatus,
} from "@/lib/channels/email";

function toStringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toPort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeEmailSettings(body: Record<string, unknown>) {
  const source =
    body.config && typeof body.config === "object"
      ? (body.config as Record<string, unknown>)
      : body;

  return {
    smtpHost: toStringValue(source.smtpHost),
    smtpPort: toPort(source.smtpPort, 587),
    smtpUser: toStringValue(source.smtpUser),
    smtpPass: toStringValue(source.smtpPass),
    smtpFrom: toStringValue(source.smtpFrom || source.fromAddress),
    imapHost: toStringValue(source.imapHost),
    imapPort: toPort(source.imapPort, 993),
    imapUser: toStringValue(source.imapUser),
    imapPass: toStringValue(source.imapPass),
  };
}

async function getOrCreateSettings() {
  return prisma.settings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

function serializeEmailSettings(
  settings: Awaited<ReturnType<typeof getOrCreateSettings>>
) {
  return {
    smtpHost: settings.smtpHost || "",
    smtpPort: settings.smtpPort || 587,
    smtpUser: settings.smtpUser || "",
    smtpPass: settings.smtpPass || "",
    smtpFrom: settings.smtpFrom || "",
    imapHost: settings.imapHost || "",
    imapPort: settings.imapPort || 993,
    imapUser: settings.imapUser || "",
    imapPass: settings.imapPass || "",
  };
}

export async function GET() {
  const status = getEmailStatus();
  const settings = await getOrCreateSettings();
  const config = serializeEmailSettings(settings);

  return NextResponse.json({
    id: "email",
    type: "email",
    isActive: false,
    config,
    ...status,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  if (action === "test") {
    const settings = await getOrCreateSettings();
    const config = serializeEmailSettings(settings);

    return NextResponse.json({
      success: true,
      message: "Email settings loaded successfully",
      config,
    });
  }
if (action === "send-test-email") {
  const settings = await getOrCreateSettings();

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth:
      settings.smtpUser && settings.smtpPass
        ? {
            user: settings.smtpUser,
            pass: settings.smtpPass,
          }
        : undefined,
  });

  const from = settings.smtpFrom || settings.smtpUser || "test@owly.local";

  const result = await transporter.sendMail({
    from,
    to: from,
    subject: "Owly SMTP Test",
    text: "SMTP4Dev test maili başarıyla gönderildi.",
  });

  return NextResponse.json({
    success: true,
    connected: getEmailStatus().connected,
    message: "Test email sent successfully",
    messageId: result.messageId,
  });
}

  if (action === "connect") {
    await startEmailListener();
    const status = getEmailStatus();

    await prisma.channel.upsert({
      where: { type: "email" },
      update: { status: status.status },
      create: {
        type: "email",
        status: status.status,
        isActive: true,
        config: {},
      },
    });

    return NextResponse.json(status);
  }

  if (action === "disconnect") {
    await stopEmailListener();

    await prisma.channel.upsert({
      where: { type: "email" },
      update: { status: "disconnected" },
      create: {
        type: "email",
        status: "disconnected",
        isActive: false,
        config: {},
      },
    });

    return NextResponse.json({ status: "disconnected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const config = normalizeEmailSettings(body);
  const isActive = Boolean(body.isActive);

  await prisma.settings.upsert({
    where: { id: "default" },
    update: config,
    create: {
      id: "default",
      ...config,
    },
  });

  const channel = await prisma.channel.upsert({
    where: { type: "email" },
    update: {
      isActive,
      config,
      status: "disconnected",
    },
    create: {
      type: "email",
      isActive,
      config,
      status: "disconnected",
    },
  });

  return NextResponse.json(channel);
}
