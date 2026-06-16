import Imap from "imap";
import { createNotification } from "@/lib/notifications";
import { simpleParser, ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { chat, createNewConversation } from "@/lib/ai/engine";
import { escapeHtml, sanitizeEmailSubject } from "@/lib/security";
import { logger } from "@/lib/logger";
import { resolveCustomer } from "@/lib/customer-resolver";
import {
  emitNewMessage,
  emitConversationUpdate,
  publish,
} from "@/lib/realtime";

interface EmailConfig {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
}

let imapConnection: Imap | null = null;
let isListening = false;
let isConnecting = false;
let shouldReconnect = false;
let reconnectTimer: NodeJS.Timeout | null = null;

function scheduleReconnect() {
  if (!shouldReconnect) return;
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    logger.info("[Email] Reconnecting IMAP...");

    startEmailListener().catch((error) =>
      logger.error("[Email] IMAP reconnect failed:", error)
    );
  }, 5000);
}

async function getEmailConfig(): Promise<EmailConfig | null> {
  const settings = await prisma.settings.findFirst({
    where: { id: "default" },
  });

  if (!settings?.imapHost?.trim() || !settings?.smtpHost?.trim()) return null;

  return {
    imapHost: settings.imapHost.trim(),
    imapPort: settings.imapPort,
    imapUser: settings.imapUser?.trim() || "",
    imapPass: settings.imapPass || "",
    smtpHost: settings.smtpHost.trim(),
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser?.trim() || "",
    smtpPass: settings.smtpPass || "",
    smtpFrom:
      settings.smtpFrom?.trim() || settings.smtpUser?.trim() || "test@owly.local",
  };
}

function createImapConnection(config: EmailConfig): Imap {
  return new Imap({
    user: config.imapUser,
    password: config.imapPass,
    host: config.imapHost,
    port: config.imapPort,
    tls: config.imapPort === 993,
    tlsOptions: { rejectUnauthorized: false },
  });
}

function getSmtpTransporter(config: EmailConfig) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth:
      config.smtpUser || config.smtpPass
        ? {
            user: config.smtpUser,
            pass: config.smtpPass,
          }
        : undefined,
  });
}

async function processEmail(parsed: ParsedMail, config: EmailConfig) {
  const fromAddress = parsed.from?.value?.[0]?.address;
  const fromName = parsed.from?.value?.[0]?.name || fromAddress || "Unknown";
  const subject = parsed.subject || "No Subject";
  const textBody = parsed.text || "";

  if (
    subject.includes("Owly SMTP Test") ||
    fromAddress === config.smtpFrom ||
    fromAddress === config.smtpUser
  ) {
    logger.info(`[Email] Ignored internal/test email subject=${subject}`);
    return;
  }

  if (!fromAddress) return;

  const customerId = await resolveCustomer("email", fromAddress, fromName);

  let conversation = await prisma.conversation.findFirst({
    where: {
      channel: "email",
      status: { in: ["active", "escalated"] },
      OR: [{ customerId }, { customerContact: fromAddress }],
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (!conversation) {
    conversation = await createNewConversation(
      "email",
      fromName,
      fromAddress,
      customerId
    );
  }

  const messageContent = `Subject: ${subject}\n\n${textBody}`;

  const savedCustomerMsg = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "customer",
      content: messageContent,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  emitNewMessage(conversation.id, {
    id: savedCustomerMsg.id,
    role: "customer",
    content: messageContent,
    createdAt: savedCustomerMsg.createdAt.toISOString(),
  });

  emitConversationUpdate(conversation.id, {
    lastMessage: messageContent,
    updatedAt: savedCustomerMsg.createdAt.toISOString(),
  });

  publish("global", {
    type: "notification",
    conversationId: conversation.id,
    data: {
      id: savedCustomerMsg.id,
      source: "email",
      title: "Yeni Email",
      message: `${fromName}: ${subject}`,
      conversationId: conversation.id,
      url: `/conversations?conversationId=${conversation.id}`,
    },
  });

  await createNotification({
  title: "Yeni Email",
  content: `${fromName}: ${subject}`,
  source: "email",
  conversationId: conversation.id,
  url: `/conversations?conversationId=${conversation.id}`,
});

  const fullConversation = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    select: {
      aiEnabled: true,
    },
  });

  if (fullConversation?.aiEnabled === false) {
    logger.info(
      `[Email] AI disabled for conversation=${conversation.id}; message saved, no AI reply`
    );
    return;
  }

  const aiResponse = await chat(conversation.id, messageContent, {
    saveUserMessage: false,
  });

  const branding = await getEmailBranding();
  const transporter = getSmtpTransporter(config);

  await transporter.sendMail({
    from: config.smtpFrom,
    to: fromAddress,
    subject: sanitizeEmailSubject(`Re: ${subject}`),
    text: aiResponse,
    html: buildEmailHtml(aiResponse, branding),
    inReplyTo: parsed.messageId,
    references: parsed.messageId,
  });
}

interface EmailBranding {
  businessName: string;
  primaryColor?: string;
}

async function getEmailBranding(): Promise<EmailBranding> {
  const settings = await prisma.settings.findFirst({
    select: { businessName: true },
  });

  return {
    businessName: settings?.businessName || "Support",
  };
}

function buildEmailHtml(text: string, branding?: EmailBranding): string {
  const name = branding?.businessName || "Support";
  const color = branding?.primaryColor || "#0F172A";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background-color:${escapeHtml(color)};padding:20px 24px;">
          <h1 style="margin:0;font-size:18px;font-weight:600;color:#FFFFFF;">${escapeHtml(name)}</h1>
        </td></tr>
        <tr><td style="padding:24px;">
          ${text
            .split("\n")
            .map(
              (line) =>
                `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(
                  line
                )}</p>`
            )
            .join("")}
        </td></tr>
        <tr><td style="border-top:1px solid #E2E8F0;padding:16px 24px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94A3B8;">${escapeHtml(
            name
          )} &middot; Powered by Owly</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function startEmailListener() {
  logger.info("[Email] startEmailListener called");

  if (isListening || isConnecting) {
    logger.info("[Email] Already listening or connecting");
    return;
  }

  isConnecting = true;

  const config = await getEmailConfig();

  logger.info(
    `[Email] config smtpHost=${config?.smtpHost || "-"} imapHost=${
      config?.imapHost || "-"
    } imapPort=${config?.imapPort || "-"}`
  );

  if (!config) {
    logger.info("[Email] Not configured, skipping listener start");
    isConnecting = false;
    return;
  }

  shouldReconnect = true;

  const imap = createImapConnection(config);

  imap.once("ready", () => {
    logger.info("[Email] IMAP connected");
    isConnecting = false;
    isListening = true;

    imap.openBox("INBOX", false, (err) => {
      if (err) {
        logger.error("[Email] Error opening inbox:", err);
        isListening = false;
        imapConnection = null;
        scheduleReconnect();
        return;
      }

      imap.on("mail", () => {
        imap.search(["UNSEEN"], (err, results) => {
          if (err || !results.length) return;

          const fetch = imap.fetch(results, { bodies: "" });

          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              simpleParser(stream as any, (err: Error | null, parsed: ParsedMail) => {
                if (err) {
                  logger.error("[Email] Parse error:", err);
                  return;
                }

                processEmail(parsed, config).catch((e) =>
                  logger.error("[Email] Failed to process email:", e)
                );
              });
            });
          });
        });
      });
    });
  });

  imap.once("error", (err: Error) => {
    logger.error("[Email] IMAP error:", err);
    isConnecting = false;
    isListening = false;
    imapConnection = null;
    scheduleReconnect();
  });

  imap.once("end", () => {
    logger.info("[Email] IMAP disconnected");
    isConnecting = false;
    isListening = false;
    imapConnection = null;
    scheduleReconnect();
  });

  imapConnection = imap;

  try {
    imap.connect();
  } catch (error) {
    isConnecting = false;
    isListening = false;
    imapConnection = null;
    logger.error("[Email] IMAP connect failed:", error);
    scheduleReconnect();
  }
}

export async function stopEmailListener() {
  shouldReconnect = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (imapConnection) {
    imapConnection.end();
    imapConnection = null;
  }

  isConnecting = false;
  isListening = false;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  isConnecting = true;

  const config = await getEmailConfig();
  if (!config) return false;

  const branding = await getEmailBranding();
  const transporter = getSmtpTransporter(config);

  await transporter.sendMail({
    from: config.smtpFrom,
    to,
    subject,
    text: body,
    html: buildEmailHtml(body, branding),
  });

  return true;
}

export function getEmailStatus() {
  return {
    connected: isListening,
    status: isListening ? "connected" : "disconnected",
  };
}
