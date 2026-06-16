import { Client, LocalAuth, Message } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import { prisma } from "@/lib/prisma";
import { chat, createNewConversation } from "@/lib/ai/engine";
import { logger } from "@/lib/logger";
import { resolveCustomer } from "@/lib/customer-resolver";
import { emitNewMessage, emitConversationUpdate, publish } from "@/lib/realtime";
import * as fs from "fs";
import * as path from "path";

type WhatsAppConnectionStatus =
  | "disconnected"
  | "qr_ready"
  | "connecting"
  | "connected"
  | "error";

type WhatsAppGlobalState = {
  client: Client | null;
  qr: string | null;
  status: WhatsAppConnectionStatus;
  message: string;
  initializing: boolean;
};

const globalForWhatsApp = globalThis as typeof globalThis & {
  __owlyWhatsAppState?: WhatsAppGlobalState;
};

const state =
  globalForWhatsApp.__owlyWhatsAppState ??
  (globalForWhatsApp.__owlyWhatsAppState = {
    client: null,
    qr: null,
    status: "disconnected",
    message: "",
    initializing: false,
  });

function getStatePath() {
  return path.join(process.cwd(), ".whatsapp-state.json");
}

function cleanupChromiumLocks() {
  const sessionPath = path.join(process.cwd(), ".wwebjs_auth", "session");

  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

  for (const file of lockFiles) {
    const filePath = path.join(sessionPath, file);

    try {
      if (fs.existsSync(filePath)) {
        logger.info(`[WhatsApp] Removing Chromium lock: ${filePath}`);
        fs.rmSync(filePath, { force: true, recursive: true });
      }
    } catch (err) {
      logger.error(`[WhatsApp] Failed to remove Chromium lock ${file}:`, err);
    }
  }
}

async function destroyClientSafely() {
  if (!state.client) return;

  try {
    logger.info("[WhatsApp] Destroying stale client...");
    await state.client.destroy();
  } catch (err) {
    logger.error("[WhatsApp] Error while destroying stale client:", err);
  }

  state.client = null;
}

async function getRealClientState(client: Client | null): Promise<string | null> {
  if (!client) return null;

  try {
    return await client.getState();
  } catch {
    return null;
  }
}

export function getWhatsAppStatus() {
  const statePath = getStatePath();

  if (fs.existsSync(statePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));

      if (saved.qr) {
        return {
          status: saved.status || "qr_ready",
          qr: saved.qr,
          message:
            saved.message || "Scan the QR code with WhatsApp on your phone",
        };
      }
    } catch (err) {
      logger.error("[WhatsApp] Failed to read saved QR state:", err);
    }
  }

  return {
    status: state.status,
    qr: state.qr,
    message: state.message,
  };
}

export async function initWhatsApp(): Promise<void> {
  if (state.initializing) {
    logger.info("[WhatsApp] Initialize already running");
    return;
  }

  state.initializing = true;

  try {
    if (state.client) {
      const realState = await getRealClientState(state.client);

      logger.info(`[WhatsApp] Existing client real state=${realState}`);

      if (realState === "CONNECTED") {
        state.status = "connected";
        state.message = "Connected to WhatsApp";
        state.initializing = false;
        return;
      }

      await destroyClientSafely();
    }

    cleanupChromiumLocks();

    state.status = "connecting";
    state.message = "Initializing WhatsApp client...";

    logger.info("[WhatsApp] Creating new WhatsApp client...");

    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: ".wwebjs_auth",
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
        ],
      },
    });

    state.client = client;

    client.on("qr", async (qr: string) => {
      logger.info("[WhatsApp] QR code received");

      const qrDataUrl = await qrcode.toDataURL(qr);

      state.qr = qrDataUrl;
      state.status = "qr_ready";
      state.message = "Scan the QR code with WhatsApp on your phone";

      fs.writeFileSync(
        getStatePath(),
        JSON.stringify(
          {
            status: "qr_ready",
            qr: qrDataUrl,
            message: state.message,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf8"
      );
    });

    client.on("ready", async () => {
      logger.info("[WhatsApp] Client is ready");

      state.client = client;
      state.qr = null;
      state.status = "connected";
      state.message = "Connected to WhatsApp";

      const statePath = getStatePath();
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }

      await prisma.channel.upsert({
        where: { type: "whatsapp" },
        update: { isActive: true, status: "connected" },
        create: { type: "whatsapp", isActive: true, status: "connected" },
      });
    });

    client.on("authenticated", () => {
      logger.info("[WhatsApp] Authenticated");

      state.client = client;
      state.status = "connecting";
      state.message = "Authenticated, loading chats...";
    });

    client.on("auth_failure", async (message: string) => {
      logger.error(`[WhatsApp] Auth failure: ${message}`);

      state.status = "error";
      state.message = `Authentication failed: ${message}`;

      await destroyClientSafely();

      await prisma.channel.upsert({
        where: { type: "whatsapp" },
        update: { isActive: false, status: "error" },
        create: { type: "whatsapp", isActive: false, status: "error" },
      });
    });

    client.on("disconnected", async (reason: string) => {
      logger.info(`[WhatsApp] Disconnected: ${reason}`);

      await destroyClientSafely();

      state.qr = null;
      state.status = "disconnected";
      state.message = `Disconnected: ${reason}`;

      await prisma.channel.upsert({
        where: { type: "whatsapp" },
        update: { isActive: false, status: "disconnected" },
        create: { type: "whatsapp", isActive: false, status: "disconnected" },
      });
    });

    client.on("message", async (message: Message) => {
      logger.info(
        `[WhatsApp] Raw message event from=${message.from} body=${
          message.body ? message.body.substring(0, 50) : ""
        } hasMedia=${message.hasMedia}`
      );

      try {
        if (message.fromMe) {
          logger.info("[WhatsApp] Ignoring message because fromMe=true");
          return;
        }

        const contact = await message.getContact();
        const customerName = contact.pushname || contact.name || "Unknown";
        const customerContact = message.from;

        logger.info(
          `[WhatsApp] Processing incoming message from customerName=${customerName} contact=${customerContact}`
        );

        const customerId = await resolveCustomer(
          "whatsapp",
          customerContact,
          customerName
        );

let conversation = await prisma.conversation.findFirst({
  where: {
    channel: "whatsapp",
    customerContact,
    status: { in: ["active", "escalated"] },
  },
  orderBy: {
    updatedAt: "desc",
  },
});

if (!conversation && customerId) {
  conversation = await prisma.conversation.findFirst({
    where: {
      channel: "whatsapp",
      customerId,
      status: { in: ["active", "escalated"] },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

        if (!conversation) {
          conversation = await createNewConversation(
            "whatsapp",
            customerName,
            customerContact,
            customerId
          );
        }

        let messageContent = message.body;

        if (message.hasMedia) {
          const media = await message.downloadMedia();

          if (media) {
            const mediaType = media.mimetype.split("/")[0];

            messageContent = `[${mediaType} attachment: ${
              media.filename || "media"
            }] ${message.body || ""}`;

            if (mediaType === "audio") {
              messageContent = `[Voice message received] ${
                message.body || ""
              }`;
            }
          }
        }


        const savedCustomerMsg = await prisma.message.create({
  data: {
    conversationId: conversation.id,
    role: "customer",
    content: messageContent,
  },
});

logger.info(
  `[WhatsApp] Saved incoming message id=${savedCustomerMsg.id} conversation=${conversation.id} aiEnabledCheckWillRun=true`
);

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
  data: {
    id: savedCustomerMsg.id,
    source: "whatsapp",
    title: "Yeni WhatsApp mesajı",
    message: `${customerName}: ${messageContent}`,
    conversationId: conversation.id,
    url: `/conversations?conversationId=${conversation.id}`,
  },
});

const fullConversation = await prisma.conversation.findUnique({
  where: { id: conversation.id },
  select: {
    aiEnabled: true,
  },
});

if (fullConversation?.aiEnabled === false) {
  logger.info(
    `[WhatsApp] AI disabled for conversation=${conversation.id}; message saved, no AI reply`
  );
  return;
}

const aiResponse = await chat(conversation.id, messageContent, {
  saveUserMessage: false,
});

await message.reply(aiResponse);

      } catch (error) {
        logger.error("[WhatsApp] Failed to process message:", error);
      }
    });

    await client.initialize();
  } catch (error) {
    logger.error("[WhatsApp] Failed to initialize client:", error);

    await destroyClientSafely();

    state.status = "error";
    state.message =
      error instanceof Error ? error.message : "Failed to initialize client";

    await prisma.channel.upsert({
      where: { type: "whatsapp" },
      update: { isActive: false, status: "error" },
      create: { type: "whatsapp", isActive: false, status: "error" },
    });
  } finally {
    state.initializing = false;
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  logger.info("[WhatsApp] Disconnecting...");

  if (state.client) {
    try {
      logger.info("[WhatsApp] Attempting graceful logout...");
      await state.client.logout();
      logger.info("[WhatsApp] Logged out successfully");
    } catch (logoutError) {
      logger.error(
        "[WhatsApp] Error during client.logout(), destroying client...",
        logoutError
      );

      await destroyClientSafely();
    }
  }

  const sessionPath = path.join(process.cwd(), ".wwebjs_auth", "session");

  if (fs.existsSync(sessionPath)) {
    try {
      logger.info(`[WhatsApp] Deleting session folder at ${sessionPath}`);
      fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch (err) {
      logger.error("[WhatsApp] Failed to delete session folder:", err);
    }
  }

  const statePath = getStatePath();
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }

  state.client = null;
  state.qr = null;
  state.status = "disconnected";
  state.message = "Disconnected";

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
  logger.info(
    `[WhatsApp] sendWhatsAppMessage called to=${to} messageLen=${message.length}`
  );

  logger.info(
    `[WhatsApp] DEBUG client=${!!state.client} status=${state.status}`
  );

  if (!state.client) {
    logger.error("[WhatsApp] sendWhatsAppMessage failed: client is null");

    await initWhatsApp();

    if (!state.client) {
      return false;
    }
  }

  const realState = await getRealClientState(state.client);

  logger.info(`[WhatsApp] Real client state=${realState}`);

  if (realState !== "CONNECTED") {
    logger.error(
      `[WhatsApp] sendWhatsAppMessage failed: realState=${realState}`
    );

    state.status = "connecting";
    state.message = "WhatsApp client is reconnecting...";

    await initWhatsApp();

    const retryState = await getRealClientState(state.client);

    if (retryState !== "CONNECTED") {
      logger.error(
        `[WhatsApp] sendWhatsAppMessage retry failed: realState=${retryState}`
      );
      return false;
    }
  }

  try {
    const chatId = to.includes("@") ? to : `${to}@c.us`;

    logger.info(`[WhatsApp] Sending message to JID=${chatId}`);

    await state.client!.sendMessage(chatId, message);

    logger.info(`[WhatsApp] Message successfully sent to JID=${chatId}`);
    return true;
  } catch (error) {
    logger.error(`[WhatsApp] Failed to send message to ${to}:`, error);
    return false;
  }
}
