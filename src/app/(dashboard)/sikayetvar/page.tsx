"use client";

import { Header } from "@/components/layout/header";
import { cn, formatRelativeTime } from "@/lib/utils";
import { CheckCircle2, Circle, ExternalLink, RefreshCw, Search, MessageCircleWarning } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Complaint = {
  id: string;
  title: string;
  url: string;
  content: string;
  answered: boolean;
  answerNote: string;
  pageNumber: number;
  publishedAt: string | null;
  firstSeenAt: string;
  updatedAt: string;
};

const filters = [
  { value: "all", label: "Tümü" },
  { value: "pending", label: "Cevap bekleyenler" },
  { value: "answered", label: "Cevaplananlar" },
];

export default function SikayetvarPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedComplaint = useMemo(
    () => complaints.find((complaint) => complaint.id === selectedId) || complaints[0] || null,
    [complaints, selectedId]
  );

  const stats = useMemo(() => {
    const total = complaints.length;
    const answered = complaints.filter((item) => item.answered).length;
    return { total, answered, pending: total - answered };
  }, [complaints]);

  const fetchComplaints = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/sikayetvar?${params.toString()}`);
      if (!res.ok) throw new Error("Şikayetvar kayıtları yüklenemedi");

      const data = await res.json();
      setComplaints(data.data || []);
    } catch (err) {
      console.error(err);
      setError("Şikayetvar kayıtları yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);

    try {
      const res = await fetch("/api/sikayetvar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) throw new Error("Senkronizasyon başarısız");
      await fetchComplaints();
    } catch (err) {
      console.error(err);
      setError("Şikayetvar senkronizasyonu başarısız oldu.");
    } finally {
      setSyncing(false);
    }
  };

  const updateComplaint = async (id: string, data: Partial<Pick<Complaint, "answered">>) => {
    const previous = complaints;
    setComplaints((items) =>
      items.map((item) => (item.id === id ? { ...item, ...data } : item))
    );

    try {
      const res = await fetch(`/api/sikayetvar/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error("Güncelleme başarısız");
      const updated = await res.json();
      setComplaints((items) => items.map((item) => (item.id === id ? updated : item)));
    } catch (err) {
      console.error(err);
      setComplaints(previous);
      setError("Şikayet güncellenemedi.");
    } finally {
      // no-op
    }
  };

  return (
    <>
      <Header
        title="Şikayetvar"
        description="Dermoeczanem şikayetlerini takip edin, cevap durumlarını işaretleyin"
      />

      <div className="flex-1 flex overflow-hidden bg-owly-bg">
        <div className="w-full md:w-[460px] border-r border-owly-border bg-owly-surface flex flex-col">
          <div className="p-4 border-b border-owly-border space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-owly-border bg-owly-bg p-3">
                <p className="text-xs text-owly-text-light">Toplam</p>
                <p className="text-lg font-semibold text-owly-text">{stats.total}</p>
              </div>
              <div className="rounded-lg border border-owly-border bg-owly-bg p-3">
                <p className="text-xs text-owly-text-light">Bekleyen</p>
                <p className="text-lg font-semibold text-amber-600">{stats.pending}</p>
              </div>
              <div className="rounded-lg border border-owly-border bg-owly-bg p-3">
                <p className="text-xs text-owly-text-light">Cevaplanan</p>
                <p className="text-lg font-semibold text-green-600">{stats.answered}</p>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-owly-text-light" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Başlık veya içerik ara..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
              />
            </div>

            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 text-sm px-3 py-2 border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 text-owly-text"
              >
                {filters.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>

              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-owly-primary text-white hover:bg-owly-primary-dark disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                Tara
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="h-40 flex items-center justify-center text-sm text-owly-text-light">
                Yükleniyor...
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-red-600">{error}</div>
            ) : complaints.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center px-6">
                <div className="p-4 rounded-full bg-owly-primary-50 mb-4">
                  <MessageCircleWarning className="h-8 w-8 text-owly-primary" />
                </div>
                <p className="font-medium text-owly-text">Şikayet bulunamadı</p>
                <p className="text-sm text-owly-text-light mt-1">
                  İlk tarama için Tara butonunu kullanın.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-owly-border">
                {complaints.map((complaint) => {
                  const selected = selectedComplaint?.id === complaint.id;

                  return (
                    <button
                      key={complaint.id}
                      onClick={() => setSelectedId(complaint.id)}
                      className={cn(
                        "w-full text-left p-4 hover:bg-owly-primary-50/50 transition-colors",
                        selected && "bg-owly-primary-50 border-l-2 border-l-owly-primary"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            updateComplaint(complaint.id, { answered: !complaint.answered });
                          }}
                          className="mt-0.5 text-owly-text-light hover:text-owly-primary"
                          title={complaint.answered ? "Cevaplandı" : "Cevap bekliyor"}
                        >
                          {complaint.answered ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : (
                            <Circle className="h-5 w-5 text-amber-500" />
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-full text-xs font-medium",
                                complaint.answered
                                  ? "bg-green-50 text-green-700"
                                  : "bg-amber-50 text-amber-700"
                              )}
                            >
                              {complaint.answered ? "Cevaplandı" : "Bekliyor"}
                            </span>
                          </div>

                          <p className="mt-1 text-sm font-medium text-owly-text line-clamp-2">
                            {complaint.title}
                          </p>

                          <p className="mt-1 text-xs text-owly-text-light">
                            İlk görüldü: {formatRelativeTime(complaint.firstSeenAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="hidden md:flex flex-1 flex-col bg-owly-bg">
          {!selectedComplaint ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <MessageCircleWarning className="h-10 w-10 text-owly-text-light mb-3" />
              <p className="font-semibold text-lg text-owly-text">Şikayet seçin</p>
              <p className="text-sm text-owly-text-light mt-1">
                Detayları görmek ve cevap durumunu işaretlemek için soldan bir kayıt seçin.
              </p>
            </div>
          ) : (
            <>
              <div className="px-6 py-4 bg-owly-surface border-b border-owly-border flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        selectedComplaint.answered
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      )}
                    >
                      {selectedComplaint.answered ? "Cevaplandı" : "Cevap bekliyor"}
                    </span>
                    <span className="text-xs text-owly-text-light">
                      İlk görüldü: {formatRelativeTime(selectedComplaint.firstSeenAt)}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-owly-text">
                    {selectedComplaint.title}
                  </h2>
                </div>

                {selectedComplaint.url.startsWith("http") && (
                  <a
                    href={selectedComplaint.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-owly-border bg-owly-bg text-owly-text hover:bg-owly-primary-50 transition-colors"
                  >
                    Aç
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="bg-owly-surface border border-owly-border rounded-xl p-5">
                  <h3 className="font-semibold text-owly-text mb-2">Şikayet İçeriği</h3>
                  <p className="text-sm text-owly-text-light whitespace-pre-wrap leading-6">
                    {selectedComplaint.content || "İçerik henüz çekilemedi. Şikayetvar sayfasından açarak kontrol edin."}
                  </p>
                </div>

                {selectedComplaint.answerNote && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                    <h3 className="font-semibold text-owly-text mb-2">Firma Cevabı</h3>
                    <p className="text-sm text-owly-text whitespace-pre-wrap leading-6">
                      {selectedComplaint.answerNote}
                    </p>
                  </div>
                )}

                <div className="bg-owly-surface border border-owly-border rounded-xl p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-owly-text">Cevap Durumu</h3>
                    <label className="inline-flex items-center gap-2 text-sm text-owly-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedComplaint.answered}
                        onChange={(e) =>
                          updateComplaint(selectedComplaint.id, { answered: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-owly-border"
                      />
                      Cevaplandı
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
