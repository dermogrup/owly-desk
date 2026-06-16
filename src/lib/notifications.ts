import { prisma } from "@/lib/prisma";

export async function createNotification(data: {
  title: string;
  content: string;
  source: string;
  conversationId?: string;
  url?: string;
}) {
  return prisma.notification.create({
    data: {
      title: data.title,
      content: data.content,
      source: data.source,
      conversationId: data.conversationId,
      url: data.url,
    },
  });
}
