import { logger } from "@/lib/logger";
import { fetchAndStoreSikayetvarComplaints } from "@/lib/sikayetvar/scraper";

type SchedulerState = {
  started: boolean;
  lastRunKeys: Set<string>;
  timer?: NodeJS.Timeout;
};

const globalForSikayetvar = globalThis as typeof globalThis & {
  __owlySikayetvarScheduler?: SchedulerState;
};

const schedulerState =
  globalForSikayetvar.__owlySikayetvarScheduler ??
  (globalForSikayetvar.__owlySikayetvarScheduler = {
    started: false,
    lastRunKeys: new Set<string>(),
  });

const DEFAULT_TIMES = ["08:30", "13:00", "17:00"];

function getIstanbulDateParts() {
  const formatter = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function getScheduleTimes(): string[] {
  const raw = process.env.SIKAYETVAR_SYNC_TIMES;
  if (!raw) return DEFAULT_TIMES;

  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{2}:\d{2}$/.test(item));

  return parsed.length > 0 ? parsed : DEFAULT_TIMES;
}

async function runScheduledSync(runKey: string) {
  try {
    logger.info(`[Şikayetvar] Scheduled sync started key=${runKey}`);
    await fetchAndStoreSikayetvarComplaints({ fetchDetails: true });
    logger.info(`[Şikayetvar] Scheduled sync finished key=${runKey}`);
  } catch (error) {
    logger.error(`[Şikayetvar] Scheduled sync failed key=${runKey}`, error);
  }
}

export function startSikayetvarScheduler() {
  if (schedulerState.started) {
    logger.info("[Şikayetvar] Scheduler already started");
    return;
  }

  schedulerState.started = true;
  const scheduleTimes = getScheduleTimes();

  logger.info(`[Şikayetvar] Scheduler started times=${scheduleTimes.join(",")}`);

  schedulerState.timer = setInterval(() => {
    const { dateKey, time } = getIstanbulDateParts();

    if (!scheduleTimes.includes(time)) return;

    const runKey = `${dateKey}-${time}`;
    if (schedulerState.lastRunKeys.has(runKey)) return;

    schedulerState.lastRunKeys.add(runKey);
    runScheduledSync(runKey);
  }, 60 * 1000);
}

export function stopSikayetvarScheduler() {
  if (schedulerState.timer) {
    clearInterval(schedulerState.timer);
  }

  schedulerState.started = false;
  schedulerState.timer = undefined;
}
