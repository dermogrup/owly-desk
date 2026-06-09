import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function initializeActiveChannels() {
  try {
    logger.info("[Channels] Initializing active channels on startup...");
    const activeChannels = await prisma.channel.findMany({
      where: { isActive: true },
    });

    for (const channel of activeChannels) {
      if (channel.type === "whatsapp") {
        logger.info("[Channels] Auto-starting WhatsApp channel...");
        try {
          const { initWhatsApp } = await import("./whatsapp");
          // Initialize WhatsApp in the background
          initWhatsApp().catch((err) => {
            logger.error("[Channels] Failed to auto-start WhatsApp channel:", err);
          });
        } catch (importErr) {
          logger.error("[Channels] Failed to import whatsapp channel module:", importErr);
        }
      } else if (channel.type === "email") {
        logger.info("[Channels] Auto-starting Email channel...");
        try {
          const { startEmailListener } = await import("./email");
          // Start Email listener in the background
          startEmailListener().catch((err) => {
            logger.error("[Channels] Failed to auto-start Email channel:", err);
          });
        } catch (importErr) {
          logger.error("[Channels] Failed to import email channel module:", importErr);
        }
      }
    }
  } catch (error) {
    logger.error("[Channels] Error during active channels initialization:", error);
  }
}
