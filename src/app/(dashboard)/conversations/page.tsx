"use client";

import { Header } from "@/components/layout/header";
import {
  MessageCircle,
  Mail,
  Phone,
  MessageSquare,
  Search,
  Send,
  Inbox,
  ArrowLeft,
  Tag,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  cn,
  formatRelativeTime,
  getChannelLabel,
  getStatusColor,
} from "@/lib/utils";

interface MessageData {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  createdAt: string;
}

interface TagData {
  id: string;
  tag: {
    id: string;
    name: string;
    color: string;
  };
}

interface ConversationData {
  id: string;
  channel: string;
  customerName: string;
  customerContact: string;
  status: string;
  summary: string;
  messages: MessageData[];
  _count: { messages: number };
  tags: TagData[];
  createdAt: string;
  updatedAt: string;
  aiEnabled: boolean;
}

interface RealtimePayload {
  type: string;
  conversationId?: string;
  timestamp?: string;
  data?: {
    conversationId?: string;
    messageId?: string;
    role?: string;
    content?: string;
    createdAt?: string;
    message?: Partial<MessageData>;
    [key: string]: unknown;
  };
}

const channelIcons: Record<string, React.ElementType> = {
  whatsapp: MessageCircle,
  email: Mail,
  phone: Phone,
};

const channelColors: Record<string, string> = {
  whatsapp: "text-green-600 bg-green-50",
  email: "text-blue-600 bg-blue-50",
  phone: "text-purple-600 bg-purple-50",
};

const channels = [
  { value: "all", label: "All Channels" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

const statuses = [
  { value: "all", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "escalated", label: "Escalated" },
  { value: "closed", label: "Closed" },
];

function normalizeRealtimeMessage(payload: RealtimePayload): MessageData | null {
  const conversationId = payload.conversationId || payload.data?.conversationId;

  if (!conversationId) return null;

  const rawMessage = payload.data?.message || payload.data;

  if (!rawMessage) return null;

  const id =
    typeof rawMessage.id === "string"
      ? rawMessage.id
      : typeof payload.data?.messageId === "string"
      ? payload.data.messageId
      : "";

  const role =
    typeof rawMessage.role === "string"
      ? rawMessage.role
      : typeof payload.data?.role === "string"
      ? payload.data.role
      : "";

  const content =
    typeof rawMessage.content === "string"
      ? rawMessage.content
      : typeof payload.data?.content === "string"
      ? payload.data.content
      : "";

  if (!id || !role || !content) return null;

  return {
    id,
    conversationId,
    role,
    content,
    mediaType:
      "mediaType" in rawMessage
        ? (rawMessage.mediaType as string | null)
        : null,
    mediaUrl:
      "mediaUrl" in rawMessage ? (rawMessage.mediaUrl as string | null) : null,
    createdAt:
      typeof rawMessage.createdAt === "string"
        ? rawMessage.createdAt
        : payload.timestamp || new Date().toISOString(),
  };
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const conversationId =
      searchParams.get("conversationId") || searchParams.get("id");

    if (conversationId && conversationId !== selectedIdRef.current) {
      setSelectedId(conversationId);
      setMobileShowDetail(true);
    }
  }, [searchParams]);

  const fetchConversations = useCallback(async () => {
    try {
      setFetchError(null);

      const params = new URLSearchParams();

      if (channelFilter !== "all") params.set("channel", channelFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/conversations?${params.toString()}`);

      if (!res.ok) throw new Error("Failed to load conversations");

      const data = await res.json();

      setConversations(data.data);
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      setFetchError(
        "Failed to load conversations. Please try refreshing the page."
      );
    } finally {
      setLoading(false);
    }
  }, [channelFilter, statusFilter, searchQuery]);

  const fetchConversationDetail = useCallback(async (id: string) => {
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/conversations/${id}`);

      if (res.ok) {
        const data = await res.json();
        setSelectedConversation(data);
      }
    } catch (error) {
      console.error("Failed to fetch conversation detail:", error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const appendRealtimeMessage = useCallback((message: MessageData) => {
    setSelectedConversation((prev) => {
      if (!prev || prev.id !== message.conversationId) return prev;

      const messageExists = prev.messages.some((msg) => msg.id === message.id);

      if (messageExists) return prev;

      return {
        ...prev,
        messages: [...prev.messages, message],
        updatedAt: message.createdAt,
        _count: {
          ...prev._count,
          messages: prev._count.messages + 1,
        },
      };
    });

    setConversations((prev) => {
      const index = prev.findIndex((conv) => conv.id === message.conversationId);

      if (index === -1) return prev;

      const current = prev[index];

      const messageExists = current.messages.some(
        (msg) => msg.id === message.id
      );

      const updatedConversation: ConversationData = {
        ...current,
        updatedAt: message.createdAt,
        messages: messageExists
          ? current.messages
          : [message, ...current.messages],
        _count: {
          ...current._count,
          messages: messageExists
            ? current._count.messages
            : current._count.messages + 1,
        },
      };

      const next = [...prev];
      next.splice(index, 1);

      return [updatedConversation, ...next];
    });
  }, []);

  const patchConversationList = useCallback(
    (conversationId: string, changes: Record<string, unknown>) => {
      setConversations((prev) => {
        const index = prev.findIndex((conv) => conv.id === conversationId);

        if (index === -1) return prev;

        const current = prev[index];

        const updatedAt =
          typeof changes.updatedAt === "string"
            ? changes.updatedAt
            : new Date().toISOString();

        const updatedConversation: ConversationData = {
          ...current,
          updatedAt,
          status:
            typeof changes.status === "string"
              ? changes.status
              : current.status,
          customerName:
            typeof changes.customerName === "string"
              ? changes.customerName
              : current.customerName,
          aiEnabled:
            typeof changes.aiEnabled === "boolean"
              ? changes.aiEnabled
              : current.aiEnabled,
        };

        const next = [...prev];
        next.splice(index, 1);

        return [updatedConversation, ...next];
      });

      setSelectedConversation((prev) => {
        if (!prev || prev.id !== conversationId) return prev;

        return {
          ...prev,
          updatedAt:
            typeof changes.updatedAt === "string"
              ? changes.updatedAt
              : prev.updatedAt,
          status:
            typeof changes.status === "string" ? changes.status : prev.status,
          customerName:
            typeof changes.customerName === "string"
              ? changes.customerName
              : prev.customerName,
          aiEnabled:
            typeof changes.aiEnabled === "boolean"
              ? changes.aiEnabled
              : prev.aiEnabled,
        };
      });
    },
    []
  );

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (selectedId) {
      fetchConversationDetail(selectedId);
    }
  }, [selectedId, fetchConversationDetail]);

  useEffect(() => {
    const eventSource = new EventSource("/api/realtime?channel=global");

    eventSource.onopen = () => {
      console.log("SSE connected: conversations global channel");
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimePayload;

        if (payload.type === "message:new") {
          const message = normalizeRealtimeMessage(payload);

          if (message) {
            appendRealtimeMessage(message);
          } else if (payload.conversationId === selectedIdRef.current) {
            fetchConversationDetail(payload.conversationId);
          }

          return;
        }

        if (payload.type === "conversation:new") {
          fetchConversations();
          return;
        }

        if (
          payload.type === "conversation:updated" ||
          payload.type === "conversation:assigned"
        ) {
          if (payload.conversationId) {
            patchConversationList(payload.conversationId, payload.data || {});

            if (payload.conversationId === selectedIdRef.current) {
              fetchConversationDetail(payload.conversationId);
            }
          } else {
            fetchConversations();
          }

          return;
        }
      } catch (err) {
        console.error("Error parsing realtime event:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
    };

    return () => {
      eventSource.close();
    };
  }, [
    appendRealtimeMessage,
    fetchConversationDetail,
    fetchConversations,
    patchConversationList,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation?.messages]);

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    setMobileShowDetail(true);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedId || sending) return;

    setSending(true);

    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyText.trim(), role: "admin" }),
      });

      if (res.ok) {
        setReplyText("");
        fetchConversationDetail(selectedId);
        fetchConversations();
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedId) return;

    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        fetchConversationDetail(selectedId);
        fetchConversations();
      }
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  const handleAiToggle = async () => {
    if (!selectedConversation || !selectedId) return;

    const newValue = !selectedConversation.aiEnabled;

    setSelectedConversation({
      ...selectedConversation,
      aiEnabled: newValue,
    });

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === selectedId ? { ...conv, aiEnabled: newValue } : conv
      )
    );

    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          aiEnabled: newValue,
        }),
      });

      if (res.ok) {
        const updated = await res.json();

        setSelectedConversation((prev) =>
          prev ? { ...prev, aiEnabled: updated.aiEnabled } : prev
        );

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === selectedId
              ? { ...conv, aiEnabled: updated.aiEnabled }
              : conv
          )
        );
      } else {
        setSelectedConversation({
          ...selectedConversation,
          aiEnabled: !newValue,
        });

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === selectedId ? { ...conv, aiEnabled: !newValue } : conv
          )
        );
      }
    } catch (error) {
      console.error("Failed to update AI state:", error);

      setSelectedConversation({
        ...selectedConversation,
        aiEnabled: !newValue,
      });

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === selectedId ? { ...conv, aiEnabled: !newValue } : conv
        )
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  return (
    <>
      <Header
        title="Conversations"
        description="Manage all customer interactions"
      />

      <div className="flex-1 flex overflow-hidden">
        <div
          className={cn(
            "w-full md:w-96 lg:w-[420px] border-r border-owly-border flex flex-col bg-owly-surface",
            mobileShowDetail && "hidden md:flex"
          )}
        >
          <div className="p-3 border-b border-owly-border space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-owly-text-light" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
              />
            </div>

            <div className="flex gap-2">
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 text-owly-text"
              >
                {channels.map((ch) => (
                  <option key={ch.value} value={ch.value}>
                    {ch.label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 text-owly-text"
              >
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <div className="text-sm text-owly-text-light">Loading...</div>
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
                <div className="p-4 rounded-full bg-red-50 mb-4">
                  <Inbox className="h-8 w-8 text-red-400" />
                </div>

                <p className="font-medium text-owly-text">
                  Could not load conversations
                </p>

                <p className="text-sm text-owly-text-light mt-1">
                  {fetchError}
                </p>

                <button
                  onClick={() => {
                    setLoading(true);
                    fetchConversations();
                  }}
                  className="mt-3 px-4 py-2 text-sm font-medium text-white bg-owly-primary rounded-lg hover:bg-owly-primary/90 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
                <div className="p-4 rounded-full bg-owly-primary-50 mb-4">
                  <Inbox className="h-8 w-8 text-owly-primary" />
                </div>

                <p className="font-medium text-owly-text">
                  No conversations found
                </p>

                <p className="text-sm text-owly-text-light mt-1">
                  Conversations will appear here when customers reach out
                </p>
              </div>
            ) : (
              <div className="divide-y divide-owly-border">
                {conversations.map((conv) => {
                  const ChannelIcon =
                    channelIcons[conv.channel] || MessageSquare;
                  const lastMessage = conv.messages[0];
                  const isSelected = selectedId === conv.id;

                  return (
                    <button
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv.id)}
                      className={cn(
                        "w-full px-4 py-3.5 text-left hover:bg-owly-primary-50/50 transition-colors",
                        isSelected &&
                          "bg-owly-primary-50 border-l-2 border-l-owly-primary"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "p-2 rounded-lg mt-0.5 flex-shrink-0",
                            channelColors[conv.channel] ||
                              "text-owly-primary bg-owly-primary-50"
                          )}
                        >
                          <ChannelIcon className="h-4 w-4" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm text-owly-text truncate">
                              {conv.customerName}
                            </p>

                            <span className="text-xs text-owly-text-light flex-shrink-0 ml-2">
                              {formatRelativeTime(conv.updatedAt)}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-owly-text-light">
                              {getChannelLabel(conv.channel)}
                            </span>

                            <span className="text-xs text-owly-text-light">
                              --
                            </span>

                            <span className="text-xs text-owly-text-light">
                              {conv._count.messages} messages
                            </span>
                          </div>

                          {lastMessage && (
                            <p className="text-sm text-owly-text-light mt-1 truncate">
                              {lastMessage.role === "admin" && (
                                <span className="text-owly-primary font-medium">
                                  You:{" "}
                                </span>
                              )}

                              {lastMessage.role === "assistant" && (
                                <span className="text-owly-primary font-medium">
                                  AI:{" "}
                                </span>
                              )}

                              {lastMessage.content}
                            </p>
                          )}

                          <div className="flex items-center gap-2 mt-1.5">
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-full text-xs font-medium",
                                getStatusColor(conv.status)
                              )}
                            >
                              {conv.status}
                            </span>

                            {conv.tags.slice(0, 2).map((ct) => (
                              <span
                                key={ct.id}
                                className="px-1.5 py-0.5 rounded text-xs font-medium bg-owly-primary-50 text-owly-primary"
                              >
                                {ct.tag.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            "flex-1 flex flex-col bg-owly-bg",
            !mobileShowDetail && "hidden md:flex"
          )}
        >
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="p-5 rounded-full bg-owly-surface border border-owly-border mb-4">
                <MessageSquare className="h-10 w-10 text-owly-text-light" />
              </div>

              <p className="font-semibold text-lg text-owly-text">
                Select a conversation
              </p>

              <p className="text-sm text-owly-text-light mt-1 max-w-sm">
                Choose a conversation from the list to view the full message
                thread and reply to customers
              </p>
            </div>
          ) : detailLoading && !selectedConversation ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-sm text-owly-text-light">Loading...</div>
            </div>
          ) : selectedConversation ? (
            <>
              <div className="px-4 py-3 bg-owly-surface border-b border-owly-border flex items-center gap-3">
                <button
                  onClick={() => {
                    setMobileShowDetail(false);
                    setSelectedId(null);
                    setSelectedConversation(null);
                  }}
                  className="md:hidden p-1.5 hover:bg-owly-primary-50 rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-owly-text" />
                </button>

                <div
                  className={cn(
                    "p-2 rounded-lg flex-shrink-0",
                    channelColors[selectedConversation.channel] ||
                      "text-owly-primary bg-owly-primary-50"
                  )}
                >
                  {(() => {
                    const Icon =
                      channelIcons[selectedConversation.channel] ||
                      MessageSquare;
                    return <Icon className="h-4 w-4" />;
                  })()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-owly-text truncate">
                      {selectedConversation.customerName}
                    </h3>

                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        getStatusColor(selectedConversation.status)
                      )}
                    >
                      {selectedConversation.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-owly-text-light">
                    <span>{getChannelLabel(selectedConversation.channel)}</span>

                    {selectedConversation.customerContact && (
                      <>
                        <span>--</span>
                        <span>{selectedConversation.customerContact}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={handleAiToggle}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      selectedConversation.aiEnabled
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    )}
                  >
                    AI {selectedConversation.aiEnabled ? "ON" : "OFF"}
                  </button>

                  <select
                    value={selectedConversation.status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    className="text-xs px-2 py-1.5 border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 text-owly-text"
                  >
                    {statuses
                      .filter((s) => s.value !== "all")
                      .map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {selectedConversation.tags.length > 0 && (
                <div className="px-4 py-2 bg-owly-surface border-b border-owly-border flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-owly-text-light" />

                  {selectedConversation.tags.map((ct) => (
                    <span
                      key={ct.id}
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: ct.tag.color + "20",
                        color: ct.tag.color,
                      }}
                    >
                      {ct.tag.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {selectedConversation.messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <MessageSquare className="h-8 w-8 text-owly-text-light opacity-40 mb-2" />

                    <p className="text-sm text-owly-text-light">
                      No messages in this conversation yet
                    </p>
                  </div>
                ) : (
                  selectedConversation.messages.map((msg) => {
                    const isAdmin =
                      msg.role === "admin" || msg.role === "assistant";
                    const isSystem = msg.role === "system";

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <div className="px-3 py-1.5 bg-owly-surface border border-owly-border rounded-full text-xs text-owly-text-light">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex",
                          isAdmin ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-4 py-2.5",
                            isAdmin
                              ? "bg-owly-primary text-white rounded-br-md"
                              : "bg-owly-surface border border-owly-border text-owly-text rounded-bl-md"
                          )}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className={cn(
                                "text-xs font-medium",
                                isAdmin
                                  ? "text-white/80"
                                  : "text-owly-text-light"
                              )}
                            >
                              {isAdmin
                                ? msg.role === "assistant"
                                  ? "AI Assistant"
                                  : "Admin"
                                : selectedConversation.customerName}
                            </span>
                          </div>

                          <p className="text-sm whitespace-pre-wrap break-words">
                            {msg.content}
                          </p>

                          <p
                            className={cn(
                              "text-xs mt-1",
                              isAdmin
                                ? "text-white/60"
                                : "text-owly-text-light"
                            )}
                          >
                            {formatRelativeTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}

                <div ref={messagesEndRef} />
              </div>

              <div className="px-4 py-3 bg-owly-surface border-t border-owly-border">
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type your reply... (Enter to send, Shift+Enter for new line)"
                      rows={1}
                      className="w-full px-4 py-2.5 text-sm border border-owly-border rounded-xl bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary resize-none"
                      style={{
                        minHeight: "42px",
                        maxHeight: "120px",
                      }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = "auto";
                        target.style.height =
                          Math.min(target.scrollHeight, 120) + "px";
                      }}
                    />
                  </div>

                  <button
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || sending}
                    className={cn(
                      "p-2.5 rounded-xl transition-colors flex-shrink-0",
                      replyText.trim() && !sending
                        ? "bg-owly-primary text-white hover:bg-owly-primary-dark"
                        : "bg-owly-border text-owly-text-light cursor-not-allowed"
                    )}
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
