-- CreateTable
CREATE TABLE "SikayetvarComplaint" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "answerNote" TEXT NOT NULL DEFAULT '',
    "pageNumber" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SikayetvarComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SikayetvarComplaint_url_key" ON "SikayetvarComplaint"("url");

-- CreateIndex
CREATE INDEX "SikayetvarComplaint_answered_idx" ON "SikayetvarComplaint"("answered");

-- CreateIndex
CREATE INDEX "SikayetvarComplaint_firstSeenAt_idx" ON "SikayetvarComplaint"("firstSeenAt");

-- CreateIndex
CREATE INDEX "SikayetvarComplaint_pageNumber_idx" ON "SikayetvarComplaint"("pageNumber");
