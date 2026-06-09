import { prisma } from "@/lib/prisma";
import { chat, createNewConversation } from "@/lib/ai/engine";
import { resolveCustomer } from "@/lib/customer-resolver";
import { logger } from "@/lib/logger";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

async function getTelegramToken(): Promise<string> {
  const settings = await prisma.settings.findFirst({
    select: { telegramBotToken: true },
  });
  return settings?.telegramBotToken || "";
}

/**
 * Handle incoming Telegram webhook update.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<string | null> {
  const message = update.message;
  if (!message?.text) return null;

  try {
    const chatId = String(message.chat.id);
    const userName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
    const contact = message.from.username ? `@${message.from.username}` : chatId;

    const customerId = await resolveCustomer("telegram", contact, userName);

    let conversation = await prisma.conversation.findFirst({
      where: {
        channel: "telegram",
        status: { in: ["active", "escalated"] },
        OR: [{ customerId }, { customerContact: contact }],
      },
    });

    if (!conversation) {
      conversation = await createNewConversation("telegram", userName, contact, customerId);
    }

    const aiResponse = await chat(conversation.id, message.text);

    // Send reply via Telegram API
    const token = await getTelegramToken();
    if (token) {
      await sendTelegramMessage(token, message.chat.id, aiResponse);
    }

    return aiResponse;
  } catch (error) {
    logger.error("[Telegram] Failed to process update:", error);
    return null;
  }
}

/**
 * Send a message via Telegram Bot API.
 */
async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
      }
    );

    return response.ok;
  } catch (error) {
    logger.error("[Telegram] Failed to send message:", error);
    return false;
  }
}

/**
 * Set up Telegram webhook URL.
 */
export async function setupTelegramWebhook(
  botToken: string,
  webhookUrl: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      }
    );

    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    logger.error("[Telegram] Failed to set webhook:", error);
    return false;
  }
}

/**
 * Public function to send Telegram message without manually fetching token.
 */
export async function sendTelegram(
  chatIdStr: string,
  message: string
): Promise<boolean> {
  try {
    const token = await getTelegramToken();
    if (!token) return false;
    const chatId = Number(chatIdStr);
    if (isNaN(chatId)) return false;
    return sendTelegramMessage(token, chatId, message);
  } catch (error) {
    logger.error("[Telegram] Failed to send Telegram message:", error);
    return false;
  }
}
