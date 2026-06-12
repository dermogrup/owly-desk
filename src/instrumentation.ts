export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerShutdownHandlers } = await import("@/lib/shutdown");
    registerShutdownHandlers();

    const { initializeActiveChannels } = await import("@/lib/channels/init");
    initializeActiveChannels();

    const { startSikayetvarScheduler } = await import("@/lib/sikayetvar/scheduler");
    startSikayetvarScheduler();
  }
}
