import puppeteer, { type Page } from "puppeteer";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { publish } from "@/lib/realtime";

const BRAND_URL = "https://www.sikayetvar.com/dermoeczanem";
const SITE_ORIGIN = "https://www.sikayetvar.com";

type ScrapedComplaint = {
  title: string;
  url: string;
  content?: string;
  pageNumber: number;
  publishedAt?: Date | null;
  answered?: boolean;
  answerNote?: string;
};

type SyncResult = {
  checked: number;
  created: number;
  updated: number;
  complaints: Array<{
    id: string;
    title: string;
    url: string;
    isNew: boolean;
  }>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `${SITE_ORIGIN}${href}`;
  return `${SITE_ORIGIN}/${href}`;
}

function slugify(value: string): string {
  return decodeHtml(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u00A0\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[“”„«»]/g, "")
    .replace(/[–—−‐‑‒]/g, "-")
    .replace(/dermo\s*[- ]\s*eczanem/g, "dermoeczanem")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function isComplaintUrl(url: string): boolean {
  try {
    const parsed = new URL(absoluteUrl(url));
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (parsed.hostname !== "www.sikayetvar.com") return false;
    if (parts.length !== 2) return false;
    if (parts[0] !== "dermoeczanem") return false;
    const excluded = new Set([
      "guvenilir",
      "sahte-urun",
      "orijinal",
      "sahte-mi",
      "sitesi",
      "urunler",
      "iletisim",
      "dermo-eczane",
      "musteri-hizmetleri",
      "orijinal-urun",
    ]);

    return !excluded.has(parts[1]);
  } catch {
    return false;
  }
}

function isExcludedComplaintTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();

  return [
    "tüm şikayetler - şikayetvar",
    "dermoeczanem şikayet ve yorumları - şikayetvar",
  ].includes(normalized);
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Şikayetvar fetch failed: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

function extractMetaContent(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regexes = [
    new RegExp(
      `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`,
      "i"
    ),
  ];

  for (const regex of regexes) {
    const match = html.match(regex);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return "";
}

function parsePublishedAt(html: string): Date | null {
  const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);

  if (timeMatch?.[1]) {
    const date = new Date(timeMatch[1]);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function hasDermoeczanemAnswer(html: string): boolean {
  if (
    html.includes('data-ga-element="Complaint_Answer_Brand"') ||
    html.includes("Complaint_Answer_Brand")
  ) {
    return true;
  }

  const messagesMatch = html.match(/<div[^>]+id=["']messages["'][\s\S]*?<\/div>\s*<\/div>/);

  if (messagesMatch?.[0]) {
    return messagesMatch[0].includes("Dermoeczanem");
  }

  return html.includes(">Dermoeczanem<") && html.includes('href="/dermoeczanem"');
}

async function scrollUntilAllComplaintCardsLoaded(
  page: Page,
  pageNumber: number
): Promise<number> {
  let lastCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < 80; i += 1) {
    const count = await page.evaluate(() => {
      return document.querySelectorAll(
        'article[data-ga-element="Complaint_Card"]'
      ).length;
    });

    if (count === lastCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastCount = count;
    }

    logger.info(
      `[Şikayetvar] page=${pageNumber} scroll=${i + 1} loadedCards=${count}`
    );

    if (count >= 24) break;
    if (stableRounds >= 8 && count > 0) break;

    await page.evaluate(() => {
      window.scrollBy(0, 1200);
    });

    await delay(700);
  }

  await delay(1500);

  return await page.evaluate(() => {
    return document.querySelectorAll('article[data-ga-element="Complaint_Card"]')
      .length;
  });
}

async function fetchComplaintDetail(
  input: ScrapedComplaint
): Promise<ScrapedComplaint> {
  if (!input.url.startsWith("http://") && !input.url.startsWith("https://")) {
    return input;
  }

  try {
    const html = await fetchHtml(input.url);

    const title = extractMetaContent(html, "og:title") || input.title;

    const description =
      extractMetaContent(html, "description") ||
      extractMetaContent(html, "og:description") ||
      input.content ||
      "";

    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
    );

    const possibleCanonicalUrl = canonicalMatch?.[1]
      ? absoluteUrl(canonicalMatch[1])
      : input.url;

    const canonicalUrl = isComplaintUrl(possibleCanonicalUrl)
      ? possibleCanonicalUrl
      : input.url;

    const answered = hasDermoeczanemAnswer(html);

    let answerNote = "";

    if (answered) {
      const answerMatch = html.match(
        /data-ga-element=["']Complaint_Answer_Brand["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i
      );

      if (answerMatch?.[1]) {
        answerNote = stripHtml(answerMatch[1]);
      }
    }

    return {
      ...input,
      title,
      url: canonicalUrl,
      content: description,
      publishedAt: parsePublishedAt(html),
      answered,
      answerNote,
    };
  } catch (error) {
    logger.error(`[Şikayetvar] Failed to fetch detail url=${input.url}`, error);
    return input;
  }
}

export async function scrapeSikayetvarComplaints(options?: {
  maxPages?: number;
  fetchDetails?: boolean;
}): Promise<ScrapedComplaint[]> {
  const fetchDetails = options?.fetchDetails ?? true;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });

  const all: ScrapedComplaint[] = [];
  const seenUrls = new Set<string>();

  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1440, height: 1800 });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    );

    await page.goto(BRAND_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await delay(2000);

    const detectedMaxPage = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Sayfa navigasyonu"]');
      if (!nav) return 1;

      const numbers = Array.from(nav.querySelectorAll("a, span"))
        .map((el) => Number((el.textContent || "").trim()))
        .filter((n) => Number.isFinite(n) && n > 0);

      return numbers.length ? Math.max(...numbers) : 1;
    });

    const maxPages = options?.maxPages ?? detectedMaxPage;

    logger.info(`[Şikayetvar] Detected maxPages=${detectedMaxPage}`);
    logger.info(`[Şikayetvar] Will scan maxPages=${maxPages}`);

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const pageUrl =
        pageNumber === 1 ? BRAND_URL : `${BRAND_URL}?page=${pageNumber}`;

      logger.info(
        `[Şikayetvar] Puppeteer fetching page=${pageNumber} url=${pageUrl}`
      );

      await page.goto(pageUrl, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await delay(2000);

      const loadedCardCount = await scrollUntilAllComplaintCardsLoaded(
        page,
        pageNumber
      );

      logger.info(
        `[Şikayetvar] Loaded article count on page=${pageNumber}: ${loadedCardCount}`
      );

      const complaints = await page.evaluate((currentPageNumber) => {
        function normalizeText(value: string) {
          return value.replace(/\s+/g, " ").trim();
        }

        function cleanTitleValue(value: string) {
          return normalizeText(value)
            .replace(
              /\s*[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\d{1,2}\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+\d{2}:\d{2}.*$/u,
              ""
            )
            .replace(
              /\s*\d{1,2}\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+\d{2}:\d{2}.*$/u,
              ""
            )
            .trim();
        }

        function isExcludedTitle(value: string) {
          const normalized = normalizeText(value);
          return (
            normalized === "Tüm Şikayetler - Şikayetvar" ||
            normalized === "Dermoeczanem Şikayet ve Yorumları - Şikayetvar"
          );
        }

        function localSlugify(value: string) {
          return normalizeText(value)
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[\u00A0\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g, "")
            .replace(/[’'`´]/g, "")
            .replace(/[“”„«»]/g, "")
            .replace(/[–—−‐‑‒]/g, "-")
            .replace(/dermo\s*[- ]\s*eczanem/g, "dermoeczanem")
            .replace(/ç/g, "c")
            .replace(/ğ/g, "g")
            .replace(/ı/g, "i")
            .replace(/ö/g, "o")
            .replace(/ş/g, "s")
            .replace(/ü/g, "u")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 90);
        }

        const excluded = [
          "/dermoeczanem/guvenilir",
          "/dermoeczanem/sahte-urun",
          "/dermoeczanem/orijinal",
          "/dermoeczanem/sahte-mi",
          "/dermoeczanem/sitesi",
          "/dermoeczanem/urunler",
          "/dermoeczanem/iletisim",
          "/dermoeczanem/dermo-eczane",
          "/dermoeczanem/musteri-hizmetleri",
          "/dermoeczanem/orijinal-urun",
        ];

        return Array.from(
          document.querySelectorAll('article[data-ga-element="Complaint_Card"]')
        ).map((article, index) => {
          const allLinks = Array.from(
            article.querySelectorAll("a[href]")
          ) as HTMLAnchorElement[];

          const complaintLink =
            allLinks.find((link) => {
              const href = link.getAttribute("href") || "";

              if (!href.includes("/dermoeczanem/")) return false;
              if (href.includes("?page=")) return false;
              return !excluded.some((item) => href.endsWith(item));
            }) || null;

          const h3 = article.querySelector("h3");
          const paragraph = article.querySelector(
            ".selection-share p"
          ) as HTMLParagraphElement | null;

          const quote = article.querySelector(
            ".bg-secondary p"
          ) as HTMLParagraphElement | null;

          const customerEl = article.querySelector(
            "header span.font-bold[aria-label]"
          ) as HTMLElement | null;

          const dateEl = article.querySelector(
            "header .mt-1 span[aria-label], header span.text-zinc-500[aria-label]"
          ) as HTMLElement | null;

          const articleText = normalizeText(article.textContent || "");
          const paragraphText = normalizeText(paragraph?.textContent || "");
          const quoteText = normalizeText(quote?.textContent || "");
          const dateText = dateEl?.getAttribute("aria-label") || "";
          const customerName = customerEl?.getAttribute("aria-label") || "Kullanıcı";

          const solved =
            articleText.includes("Çözüldü") ||
            Boolean(article.querySelector('[data-ga-element="Complaint_Card_Solved"]'));

          const removed = articleText.includes("şikayetini yayından kaldırdı");

          const removedText = `${customerName} şikayetini yayından kaldırdı`;

          const rawTitle = removed
            ? removedText
            : cleanTitleValue(complaintLink?.title || "") ||
              cleanTitleValue(complaintLink?.getAttribute("aria-label") || "") ||
              cleanTitleValue(h3?.textContent || "") ||
              quoteText ||
              paragraphText.slice(0, 100) ||
              `Şikayet ${currentPageNumber}-${index + 1}`;

          const title = isExcludedTitle(rawTitle) ? "" : rawTitle;

          const generatedSlug = localSlugify(title);

          const href = complaintLink?.href
            ? complaintLink.href
            : removed
              ? `sikayetvar://dermoeczanem/page-${currentPageNumber}/card-${index + 1}`
              : `https://www.sikayetvar.com/dermoeczanem/${generatedSlug}`;

          return {
            index: index + 1,
            href,
            title,
            content: removed ? removedText : paragraphText || quoteText || "",
            dateText,
            answered: removed || Boolean(solved),
            removed,
            generated: !complaintLink,
          };
        });
      }, pageNumber);

      logger.info(
        `[Şikayetvar] Extracted complaint cards on page=${pageNumber}: ${complaints.length}`
      );

      const newComplaints: ScrapedComplaint[] = [];

      for (const item of complaints) {
        const rawHref = item.href || "";
        const url = rawHref.startsWith("sikayetvar://")
          ? rawHref
          : rawHref.split("?")[0].replace(/\/$/, "");

        const title = decodeHtml(item.title || "");
        const content = decodeHtml(item.content || "");

        let rejectReason = "";

        if (!url.startsWith("sikayetvar://") && !isComplaintUrl(url)) {
          rejectReason = "not_complaint_url";
        } else if (isExcludedComplaintTitle(title)) {
          rejectReason = "excluded_title";
        } else if (seenUrls.has(url)) {
          rejectReason = "duplicate_url";
        } else if (!title || title.length < 5) {
          rejectReason = "empty_or_short_title";
        }

        if (rejectReason) {
          logger.info(
            `[Şikayetvar] REJECT page=${pageNumber} reason=${rejectReason} url=${url} title=${title}`
          );
          continue;
        }

        logger.info(
          `[Şikayetvar] ACCEPT page=${pageNumber} generated=${item.generated} url=${url} title=${title}`
        );

        seenUrls.add(url);

        newComplaints.push({
          title,
          url,
          content,
          pageNumber,
          publishedAt: null,
          answered: item.answered,
        });
      }

      logger.info(
        `[Şikayetvar] Found ${newComplaints.length} complaint(s) on page=${pageNumber}`
      );

      if (newComplaints.length === 0) {
        logger.info(
          `[Şikayetvar] Empty page=${pageNumber}, continuing to next page`
        );
        continue;
      }

      if (fetchDetails) {
        for (const complaint of newComplaints) {
          all.push(await fetchComplaintDetail(complaint));
          await delay(400);
        }
      } else {
        all.push(...newComplaints);
      }

      await delay(700);
    }
  } finally {
    await browser.close();
  }

  const unique = new Map<string, ScrapedComplaint>();

  for (const item of all) {
    unique.set(item.url, item);
  }

  logger.info(`[Şikayetvar] Total unique complaints=${unique.size}`);

  return [...unique.values()];
}

const globalForSikayetvarSync = globalThis as typeof globalThis & {
  __sikayetvarSyncRunning?: boolean;
};

const sikayetvarSyncState = globalForSikayetvarSync;

export async function fetchAndStoreSikayetvarComplaints(options?: {
  maxPages?: number;
  fetchDetails?: boolean;
}): Promise<SyncResult> {
  if (sikayetvarSyncState.__sikayetvarSyncRunning) {
    logger.info(
      "[Şikayetvar] Sync skipped because another sync is already running"
    );

    return {
      checked: 0,
      created: 0,
      updated: 0,
      complaints: [],
    };
  }

  sikayetvarSyncState.__sikayetvarSyncRunning = true;

  try {
    const complaints = await scrapeSikayetvarComplaints(options);

    const result: SyncResult = {
      checked: complaints.length,
      created: 0,
      updated: 0,
      complaints: [],
    };

    for (const complaint of complaints) {
      const existing = await prisma.sikayetvarComplaint.findUnique({
        where: { url: complaint.url },
      });

      if (existing) {
        await prisma.sikayetvarComplaint.update({
          where: { id: existing.id },
          data: {
            title: complaint.title,
            content: complaint.content ?? existing.content,
            pageNumber: complaint.pageNumber,
            publishedAt: complaint.publishedAt ?? existing.publishedAt,
            answered: complaint.answered ?? existing.answered,
            answerNote: complaint.answerNote ?? existing.answerNote,
          },
        });

        result.updated += 1;

        result.complaints.push({
          id: existing.id,
          title: complaint.title,
          url: complaint.url,
          isNew: false,
        });

        continue;
      }

      const created = await prisma.sikayetvarComplaint.create({
        data: {
          title: complaint.title,
          url: complaint.url,
          content: complaint.content ?? "",
          pageNumber: complaint.pageNumber,
          publishedAt: complaint.publishedAt ?? null,
          answered: complaint.answered ?? false,
          answerNote: complaint.answerNote ?? "",
        },
      });

      result.created += 1;

      result.complaints.push({
        id: created.id,
        title: created.title,
        url: created.url,
        isNew: true,
      });

      publish("global", {
        type: "notification",
        data: {
          source: "sikayetvar",
          title: "Yeni Şikayetvar şikayeti",
          message: created.title,
          url: created.url,
          sikayetvarComplaintId: created.id,
        },
      });
    }

    logger.info(
      `[Şikayetvar] Sync completed checked=${result.checked} created=${result.created} updated=${result.updated}`
    );

    return result;
  } finally {
    sikayetvarSyncState.__sikayetvarSyncRunning = false;
  }
}
