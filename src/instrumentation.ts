export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerShutdownHandlers } = await import("@/lib/shutdown");
    registerShutdownHandlers();

    const { initializeActiveChannels } = await import("@/lib/channels/init");
    initializeActiveChannels();
  }
}
