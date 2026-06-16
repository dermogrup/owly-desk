/**
 * Real-time Event System
 *
 * Server-Sent Events (SSE) based real-time updates.
 * Lighter than WebSocket, works with Next.js edge runtime,
 * and doesn't require socket.io dependency.
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export type EventType =
  | "message:new"
  | "message:updated"
  | "conversation:new"
  | "conversation:updated"
  | "conversation:assigned"
  | "ticket:new"
  | "ticket:updated"
  | "typing:start"
  | "typing:stop"
  | "agent:online"
  | "agent:offline"
  | "notification";

interface EventPayload {
  type: EventType;
  data: Record<string, unknown>;
  timestamp: string;
  conversationId?: string;
}

type EventCallback = (event: EventPayload) => void;

const globalForRealtime = globalThis as typeof globalThis & {
  __owlyRealtimeSubscribers?: Map<string, Set<EventCallback>>;
};

// Next.js dev mode / hot reload sırasında modül yeniden yüklenebilir.
// Subscriber map globalThis üzerinde tutulmazsa publish ile subscribe farklı map'lere düşebilir.
const subscribers =
  globalForRealtime.__owlyRealtimeSubscribers ??
  (globalForRealtime.__owlyRealtimeSubscribers = new Map<
    string,
    Set<EventCallback>
  >());

export function subscribe(
  channel: string,
  callback: EventCallback
): () => void {
  if (!subscribers.has(channel)) {
    subscribers.set(channel, new Set());
  }

  subscribers.get(channel)!.add(callback);

  logger.info(
    `[Realtime] subscriber added channel=${channel} total=${getSubscriberCount()}`
  );

  return () => {
    const subs = subscribers.get(channel);

    if (subs) {
      subs.delete(callback);

      if (subs.size === 0) {
        subscribers.delete(channel);
      }
    }

    logger.info(
      `[Realtime] subscriber removed channel=${channel} total=${getSubscriberCount()}`
    );
  };
}

function publishToChannel(channel: string, payload: EventPayload): void {
  const subs = subscribers.get(channel);

  if (!subs || subs.size === 0) {
    logger.info(`[Realtime] no subscribers for channel=${channel}`);
    return;
  }

  for (const callback of subs) {
    try {
      callback(payload);
    } catch (error) {
      logger.error(`[Realtime] subscriber callback error channel=${channel}`, error);
    }
  }
}

async function saveNotificationToDatabase(payload: EventPayload): Promise<void> {
  if (payload.type !== "notification") return;

  try {
    const title = String(payload.data.title || "Bildirim");
    const content = String(
      payload.data.message ||
        payload.data.content ||
        payload.data.title ||
        ""
    );
    const source = String(payload.data.source || "system");
    const conversationId = payload.data.conversationId
      ? String(payload.data.conversationId)
      : payload.conversationId
        ? String(payload.conversationId)
        : null;
    const url = payload.data.url ? String(payload.data.url) : null;

    await prisma.notification.create({
      data: {
        title,
        content,
        source,
        conversationId,
        url,
      },
    });
  } catch (error) {
    logger.error("[Realtime] Notification DB save failed", error);
  }
}

export function publish(
  channel: string,
  event: Omit<EventPayload, "timestamp">
): void {
  const payload: EventPayload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  logger.info(
    `[Realtime] publish type=${payload.type} channel=${channel} conversationId=${
      payload.conversationId || ""
    }`
  );

  if (payload.type === "notification") {
    void saveNotificationToDatabase(payload);
  }

  publishToChannel(channel, payload);

  if (channel !== "global") {
    publishToChannel("global", payload);
  }
}

export function emitNewMessage(
  conversationId: string,
  message: {
    id: string;
    role: string;
    content: string;
    createdAt?: string | Date;
    mediaType?: string | null;
    mediaUrl?: string | null;
  }
): void {
  const createdAt =
    message.createdAt instanceof Date
      ? message.createdAt.toISOString()
      : message.createdAt || new Date().toISOString();

  const messageWithMeta = {
    id: message.id,
    conversationId,
    role: message.role,
    content: message.content,
    mediaType: message.mediaType ?? null,
    mediaUrl: message.mediaUrl ?? null,
    createdAt,
  };

  publish(`conversation:${conversationId}`, {
    type: "message:new",
    conversationId,
    data: {
      message: messageWithMeta,
      ...messageWithMeta,
    },
  });

  publish("global", {
    type: "message:new",
    conversationId,
    data: {
      conversationId,
      messageId: message.id,
      role: message.role,
      content: message.content,
      createdAt,
      message: messageWithMeta,
    },
  });

  emitConversationUpdate(conversationId, {
    lastMessage: message.content,
    lastMessageRole: message.role,
    updatedAt: createdAt,
  });
}

export function emitTyping(
  conversationId: string,
  userName: string,
  isTyping: boolean
): void {
  publish(`conversation:${conversationId}`, {
    type: isTyping ? "typing:start" : "typing:stop",
    conversationId,
    data: { userName, isTyping },
  });
}

export function emitConversationUpdate(
  conversationId: string,
  changes: Record<string, unknown>
): void {
  publish("global", {
    type: "conversation:updated",
    conversationId,
    data: {
      conversationId,
      ...changes,
    },
  });
}

export function getSubscriberCount(): number {
  let count = 0;

  for (const subs of subscribers.values()) {
    count += subs.size;
  }

  return count;
}
