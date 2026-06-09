import { Client, LocalAuth, Message } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import { prisma } from "@/lib/prisma";
import { chat, createNewConversation } from "@/lib/ai/engine";
import { logger } from "@/lib/logger";
import { resolveCustomer } from "@/lib/customer-resolver";
import * as fs from "fs";
import * as path from "path";

let whatsappClient: Client | null = null;
let currentQR: string | null = null;
let connectionStatus: "disconnected" | "qr_ready" | "connecting" | "connected" | "error" = "disconnected";
let statusMessage = "";

export function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    qr: currentQR,
    message: statusMessage,
  };
}

export async function initWhatsApp(): Promise<void> {
  if (whatsappClient) {
    logger.info("[WhatsApp] Client already exists");
    return;
  }

  // Pre-cleanup of legacy Chromium lockfiles that cause profile-in-use crash inside Docker
  const lockPath = path.join(process.cwd(), ".wwebjs_auth", "session", "SingletonLock");
  try {
    // fs.existsSync/statSync follows symlinks and will return false for stale symlinks,
    // but fs.lstatSync returns info for the symlink itself, allowing us to safely detect and delete it!
    fs.lstatSync(lockPath);
    logger.info(`[WhatsApp] Removing legacy Chromium lockfile/symlink at ${lockPath}`);
    fs.unlinkSync(lockPath);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      logger.error("[WhatsApp] Failed to remove Chromium lockfile:", err);
    }
  }

  connectionStatus = "connecting";
  statusMessage = "Initializing WhatsApp client...";

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", async (qr: string) => {
    logger.info("[WhatsApp] QR code received");
    currentQR = await qrcode.toDataURL(qr);
    connectionStatus = "qr_ready";
    statusMessage = "Scan the QR code with WhatsApp on your phone";
  });

  client.on("ready", async () => {
    logger.info("[WhatsApp] Client is ready");
    currentQR = null;
    connectionStatus = "connected";
    statusMessage = "Connected to WhatsApp";

    await prisma.channel.upsert({
      where: { type: "whatsapp" },
      update: { isActive: true, status: "connected" },
      create: { type: "whatsapp", isActive: true, status: "connected" },
    });
  });

  client.on("authenticated", () => {
    logger.info("[WhatsApp] Authenticated");
    connectionStatus = "connecting";
    statusMessage = "Authenticated, loading chats...";
  });

  client.on("auth_failure", (message: string) => {
    logger.error(`[WhatsApp] Auth failure: ${message}`);
    connectionStatus = "error";
    statusMessage = `Authentication failed: ${message}`;
  });

  client.on("disconnected", async (reason: string) => {
    logger.info(`[WhatsApp] Disconnected: ${reason}`);
    connectionStatus = "disconnected";
    statusMessage = `Disconnected: ${reason}`;
    whatsappClient = null;

    await prisma.channel.upsert({
      where: { type: "whatsapp" },
      update: { isActive: false, status: "disconnected" },
      create: { type: "whatsapp", isActive: false, status: "disconnected" },
    });
  });

  client.on("message", async (message: Message) => {
    logger.info(`[WhatsApp] Raw message event from=${message.from} body=${message.body ? message.body.substring(0, 50) : ""} hasMedia=${message.hasMedia}`);
    try {
      if (message.fromMe) {
        logger.info(`[WhatsApp] Ignoring message because fromMe=true`);
        return;
      }

      const contact = await message.getContact();
      const customerName = contact.pushname || contact.name || "Unknown";
      const customerContact = message.from;
      logger.info(`[WhatsApp] Processing incoming message from customerName=${customerName} contact=${customerContact}`);

      // Resolve customer identity across channels
      const customerId = await resolveCustomer("whatsapp", customerContact, customerName);

      // Find or create conversation
      let conversation = await prisma.conversation.findFirst({
        where: {
          channel: "whatsapp",
          status: { in: ["active", "escalated"] },
          OR: [
            { customerId },
            { customerContact },
          ],
        },
      });

      if (!conversation) {
        conversation = await createNewConversation(
          "whatsapp",
          customerName,
          customerContact,
          customerId
        );
      }

      let messageContent = message.body;

      // Handle media messages
      if (message.hasMedia) {
        const media = await message.downloadMedia();
        if (media) {
          const mediaType = media.mimetype.split("/")[0];
          messageContent = `[${mediaType} attachment: ${media.filename || "media"}] ${message.body || ""}`;

          if (mediaType === "audio") {
            messageContent = `[Voice message received] ${message.body || ""}`;
          }
        }
      }

      // Get AI response
      const aiResponse = await chat(conversation.id, messageContent);

      // Send response back via WhatsApp
      await message.reply(aiResponse);
    } catch (error) {
      logger.error("[WhatsApp] Failed to process message:", error);
    }
  });

  whatsappClient = client;
  try {
    await client.initialize();
  } catch (error) {
    logger.error("[WhatsApp] Failed to initialize client:", error);
    whatsappClient = null;
    connectionStatus = "error";
    statusMessage = error instanceof Error ? error.message : "Failed to initialize client";
    throw error;
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  logger.info("[WhatsApp] Disconnecting...");
  if (whatsappClient) {
    try {
      logger.info("[WhatsApp] Attempting graceful logout...");
      await whatsappClient.logout();
      logger.info("[WhatsApp] Logged out successfully");
    } catch (logoutError) {
      logger.error("[WhatsApp] Error during client.logout(), destroying client...", logoutError);
      try {
        await whatsappClient.destroy();
      } catch (destroyError) {
        logger.error("[WhatsApp] Error during client.destroy():", destroyError);
      }
    }
  }

  // Force clean up the session directory to guarantee a new QR code on next connect
  const sessionPath = path.join(process.cwd(), ".wwebjs_auth", "session");
  if (fs.existsSync(sessionPath)) {
    try {
      logger.info(`[WhatsApp] Deleting session folder at ${sessionPath}`);
      fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch (err) {
      logger.error("[WhatsApp] Failed to delete session folder:", err);
    }
  }

  whatsappClient = null;
  currentQR = null;
  connectionStatus = "disconnected";
  statusMessage = "Disconnected";

  try {
    await prisma.channel.upsert({
      where: { type: "whatsapp" },
      update: { isActive: false, status: "disconnected" },
      create: { type: "whatsapp", isActive: false, status: "disconnected" },
    });
    logger.info("[WhatsApp] Disconnected successfully, state updated in DB");
  } catch (dbError) {
    logger.error("[WhatsApp] Error updating channel status in DB:", dbError);
  }
}

export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<boolean> {
  logger.info(`[WhatsApp] sendWhatsAppMessage called to=${to} messageLen=${message.length}`);
  if (!whatsappClient) {
    logger.error(`[WhatsApp] sendWhatsAppMessage failed: client is null`);
    return false;
  }
  if (connectionStatus !== "connected") {
    logger.error(`[WhatsApp] sendWhatsAppMessage failed: connectionStatus=${connectionStatus} (not connected)`);
    return false;
  }

  try {
    const chatId = to.includes("@") ? to : `${to}@c.us`;
    logger.info(`[WhatsApp] Sending message to JID=${chatId}`);
    await whatsappClient.sendMessage(chatId, message);
    logger.info(`[WhatsApp] Message successfully sent to JID=${chatId}`);
    return true;
  } catch (error) {
    logger.error(`[WhatsApp] Failed to send message to ${to}:`, error);
    return false;
  }
}
