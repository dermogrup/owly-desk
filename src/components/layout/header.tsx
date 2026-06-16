"use client";

import { Bell, Search, Sun, Moon, LogOut, User, X } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { useRouter } from "next/navigation";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

type NotificationItem = {
  id: string;
  conversationId?: string | null;
  content: string;
  createdAt: string;
  title: string;
  url?: string | null;
};

function showBrowserNotification(notification: NotificationItem) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  new Notification(notification.title || "Owly", {
    body: notification.content,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNotificationMessage(payload: any): NotificationItem | null {
  if (!payload || payload.type !== "notification") return null;

  const data = payload.data || {};
  const id =
    data.id ||
    data.notificationId ||
    data.sikayetvarComplaintId ||
    data.conversationId ||
    `${payload.timestamp || Date.now()}-${Math.random()}`;

  return {
    id: String(id),
    conversationId: data.conversationId || "",
    content: data.message || data.content || data.title || "Yeni bildirim",
    createdAt: payload.timestamp || new Date().toISOString(),
    title: data.title || "Yeni bildirim",
    url: data.url || null,
  };
}

export function Header({ title, description, actions }: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = await response.json();
      if (Array.isArray(data.data)) {
        setNotifications(data.data.slice(0, 50));
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
    }
  }, []);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const eventSource = new EventSource("/api/realtime?channel=global");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const notification = getNotificationMessage(payload);

        if (!notification) return;

        showBrowserNotification(notification);

        setNotifications((prev) => {
          if (prev.some((item) => item.id === notification.id)) {
            return prev;
          }

          return [notification, ...prev].slice(0, 50);
        });

        setTimeout(() => {
          fetchNotifications();
        }, 300);
      } catch (error) {
        console.error("Failed to parse notification event:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("Notification SSE connection error:", error);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;

      if (menuRef.current && !menuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }

      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(target)
      ) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markNotificationAsRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Ignore notification read errors.
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });

    router.push("/login");
  };

  const openNotification = async (notification: NotificationItem) => {
    setNotifications((prev) =>
      prev.filter((item) => item.id !== notification.id)
    );

    setNotificationsOpen(false);
    await markNotificationAsRead(notification.id);

    if (notification.url?.startsWith("/")) {
      router.push(notification.url);
      return;
    }

    if (notification.conversationId) {
      router.push(`/conversations?conversationId=${notification.conversationId}`);
    }
  };

  const dismissNotification = async (notification: NotificationItem) => {
    setNotifications((prev) =>
      prev.filter((item) => item.id !== notification.id)
    );

    await markNotificationAsRead(notification.id);
  };

  const clearNotifications = async () => {
    setNotifications([]);
    setNotificationsOpen(false);

    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clearAll: true }),
      });
    } catch {
      // Ignore notification read errors.
    }
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-owly-surface border-b border-owly-border transition-theme">
      <div className="animate-fade-in">
        <h2 className="text-xl font-semibold text-owly-text">{title}</h2>
        {description && (
          <p className="text-sm text-owly-text-light mt-0.5">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {searchOpen && (
          <input
            type="text"
            placeholder="Search..."
            className="px-3 py-1.5 text-sm border border-owly-border rounded-lg bg-owly-surface text-owly-text focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary w-64 animate-slide-in-down transition-theme"
            autoFocus
            onBlur={() => setSearchOpen(false)}
          />
        )}

        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="p-2 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
          title="Search"
        >
          <Search className="h-5 w-5" />
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
          title={theme === "light" ? "Dark mode" : "Light mode"}
        >
          {theme === "light" ? (
            <Moon className="h-5 w-5" />
          ) : (
            <Sun className="h-5 w-5" />
          )}
        </button>

        <div className="relative" ref={notificationsRef}>
          <button
            onClick={() => setNotificationsOpen((value) => !value)}
            className="relative p-2 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
            title="Notifications"
          >
            <Bell className="h-5 w-5" />
            {notifications.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-owly-danger rounded-full" />
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-96 overflow-hidden bg-owly-surface border border-owly-border rounded-lg shadow-lg z-50 animate-scale-in transition-theme">
              <div className="flex items-center justify-between px-4 py-3 border-b border-owly-border">
                <div>
                  <p className="text-sm font-semibold text-owly-text">
                    Notifications
                  </p>
                  <p className="text-xs text-owly-text-light">
                    {notifications.length > 0
                      ? `${notifications.length} unread notification${
                          notifications.length > 1 ? "s" : ""
                        }`
                      : "No unread notifications"}
                  </p>
                </div>

                {notifications.length > 0 && (
                  <button
                    onClick={clearNotifications}
                    className="text-xs font-medium text-owly-primary hover:text-owly-primary-dark"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="p-6 text-center">
                  <Bell className="h-8 w-8 mx-auto text-owly-text-light opacity-40 mb-2" />
                  <p className="text-sm text-owly-text-light">
                    No notifications yet
                  </p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-owly-border">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => openNotification(notification)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          openNotification(notification);
                        }
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-owly-primary-50/60 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-owly-text">
                            {notification.title}
                          </p>
                          <p className="text-xs text-owly-text-light mt-1 truncate">
                            {notification.content}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            dismissNotification(notification);
                          }}
                          className="p-1 text-owly-text-light hover:text-owly-text rounded"
                          title="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {actions}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-owly-primary text-white text-sm font-medium hover:bg-owly-primary-dark transition-colors"
          >
            A
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-owly-surface border border-owly-border rounded-lg shadow-lg py-1 z-50 animate-scale-in transition-theme">
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  router.push("/settings");
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-owly-text hover:bg-owly-primary-50 transition-colors"
              >
                <User className="h-4 w-4" />
                Profile & Settings
              </button>

              <div className="border-t border-owly-border my-1" />

              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-owly-danger hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
