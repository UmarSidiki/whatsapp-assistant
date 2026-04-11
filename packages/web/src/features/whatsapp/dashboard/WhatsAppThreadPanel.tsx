"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Mic, Paperclip, RefreshCw, Send, Video } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ApiResponseError, fetchJson } from "@/lib/api-utils";
import { cn } from "@/lib/utils";

export interface ThreadMessage {
  id: string;
  sender: "me" | "contact";
  message: string;
  timestamp: string;
  mediaKind: string | null;
  hasMediaPayload: boolean;
}

export interface ThreadPageSeed {
  messages: ThreadMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

interface ThreadMessagesPageResponse {
  messages: ThreadMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

function normalizeAscendingMessages(rows: ThreadMessage[]): ThreadMessage[] {
  return [...rows].sort((a, b) => {
    const aTs = Date.parse(a.timestamp);
    const bTs = Date.parse(b.timestamp);
    if (aTs !== bTs) return aTs - bTs;
    return a.id.localeCompare(b.id);
  });
}

function mergeUniqueMessages(...groups: ThreadMessage[][]): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const group of groups) {
    for (const msg of group) {
      byId.set(msg.id, msg);
    }
  }
  return normalizeAscendingMessages([...byId.values()]);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function initialsFromTitle(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}

async function mediaBlobUrl(apiUrl: string, messageId: string): Promise<string | null> {
  const res = await fetch(`${apiUrl}/api/whatsapp/messages/${messageId}/media`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function WhatsAppThreadPanel({
  apiUrl,
  chatId,
  title,
  initialPage,
}: {
  apiUrl: string;
  chatId: string;
  title: string;
  initialPage?: ThreadPageSeed;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedOlderRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const hasMoreOlderRef = useRef(false);
  const nextCursorRef = useRef<string | undefined>(undefined);
  const lastOlderAttemptAtRef = useRef(0);
  const failedMediaIdsRef = useRef<Set<string>>(new Set());
  const mediaUrlsRef = useRef<Record<string, string>>({});

  const subtitle = useMemo(() => {
    const t = chatId.trim();
    if (t.length <= 42) return t;
    return `${t.slice(0, 20)}…${t.slice(-18)}`;
  }, [chatId]);

  const getViewport = useCallback((): HTMLDivElement | null => {
    const host = scrollAreaRef.current;
    if (!host) return null;
    return host.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [getViewport]);

  const fetchThreadPage = useCallback(
    async (cursor?: string): Promise<ThreadMessagesPageResponse> => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (cursor) {
        params.set("cursor", cursor);
      }

      const url = `${apiUrl}/api/whatsapp/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`;
      return fetchJson<ThreadMessagesPageResponse>(url, {
        credentials: "include",
      });
    },
    [apiUrl, chatId]
  );

  const setOlderPagination = useCallback((hasMore: boolean, cursor?: string) => {
    hasMoreOlderRef.current = hasMore;
    nextCursorRef.current = cursor;
    setHasMoreOlder(hasMore);
  }, []);

  const loadLatest = useCallback(
    async (replace: boolean, showSpinner: boolean) => {
      if (!replace && loadingOlderRef.current) {
        return;
      }

      if (showSpinner) {
        setLoading(true);
      }

      try {
        setError("");
        const page = await fetchThreadPage();
        const latestAscending = normalizeAscendingMessages(page.messages ?? []);
        const viewport = getViewport();
        const wasNearBottom =
          !viewport || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;

        setMessages((prev) => (replace ? latestAscending : mergeUniqueMessages(prev, latestAscending)));

        if (!hasLoadedOlderRef.current) {
          setOlderPagination(Boolean(page.hasMore), page.nextCursor);
        }

        if (replace || wasNearBottom) {
          requestAnimationFrame(scrollToBottom);
        }
      } catch (e) {
        if (e instanceof ApiResponseError) {
          setError(e.message);
        } else {
          setError("Failed to load messages");
        }
        if (replace) {
          setMessages([]);
          setOlderPagination(false, undefined);
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchThreadPage, getViewport, scrollToBottom, setOlderPagination]
  );

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreOlderRef.current || !nextCursorRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastOlderAttemptAtRef.current < 300) {
      return;
    }
    lastOlderAttemptAtRef.current = now;

    const cursorToLoad = nextCursorRef.current;
    if (!cursorToLoad) return;

    const viewport = getViewport();
    const previousHeight = viewport?.scrollHeight ?? 0;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      setError("");

      let page: ThreadMessagesPageResponse | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          page = await fetchThreadPage(cursorToLoad);
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 0) {
            await wait(250);
            continue;
          }
        }
      }

      if (!page) {
        throw lastError ?? new Error("Failed to load older messages");
      }

      const olderAscending = normalizeAscendingMessages(page.messages ?? []);

      if (olderAscending.length > 0) {
        hasLoadedOlderRef.current = true;
      }

      setMessages((prev) => mergeUniqueMessages(olderAscending, prev));

      const cursorDidNotAdvance = page.nextCursor && page.nextCursor === cursorToLoad;
      if (cursorDidNotAdvance) {
        setOlderPagination(false, undefined);
      } else {
        setOlderPagination(Boolean(page.hasMore), page.nextCursor);
      }

      requestAnimationFrame(() => {
        if (!viewport) return;
        const nextHeight = viewport.scrollHeight;
        viewport.scrollTop += nextHeight - previousHeight;
      });
    } catch (error) {
      if (error instanceof ApiResponseError && (error.statusCode === 400 || error.statusCode === 404)) {
        setOlderPagination(false, undefined);
      } else if (error instanceof ApiResponseError) {
        setError(error.message || "Failed to load older messages");
      } else {
        setError("Failed to load older messages");
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [fetchThreadPage, getViewport, setOlderPagination]);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const handleScroll = () => {
      if (viewport.scrollTop <= 40 && hasMoreOlderRef.current && !loadingOlderRef.current) {
        void loadOlder();
      }
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [getViewport, loadOlder]);

  useEffect(() => {
    mediaUrlsRef.current = mediaUrls;
  }, [mediaUrls]);

  useEffect(() => {
    hasLoadedOlderRef.current = false;
    loadingOlderRef.current = false;
    hasMoreOlderRef.current = false;
    nextCursorRef.current = undefined;
    failedMediaIdsRef.current.clear();
    setMediaUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      mediaUrlsRef.current = {};
      return {};
    });
    setError("");

    if (initialPage) {
      setMessages(normalizeAscendingMessages(initialPage.messages ?? []));
      setOlderPagination(Boolean(initialPage.hasMore), initialPage.nextCursor);
      setLoading(false);
      if ((initialPage.messages?.length ?? 0) > 0) {
        requestAnimationFrame(scrollToBottom);
      }
      void loadLatest(false, false);
      return;
    }

    setMessages([]);
    setOlderPagination(false, undefined);
    void loadLatest(true, true);
  }, [chatId, initialPage, loadLatest, scrollToBottom, setOlderPagination]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadLatest(false, false);
    }, 4000);

    return () => window.clearInterval(timer);
  }, [loadLatest]);

  useEffect(() => {
    return () => {
      for (const u of Object.values(mediaUrlsRef.current)) {
        URL.revokeObjectURL(u);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const m of messages) {
        if (!m.hasMediaPayload || !m.mediaKind) continue;
        if (
          m.mediaKind === "image" ||
          m.mediaKind === "video" ||
          m.mediaKind === "sticker" ||
          m.mediaKind === "audio" ||
          m.mediaKind === "voice"
        ) {
          if (mediaUrlsRef.current[m.id] || failedMediaIdsRef.current.has(m.id)) {
            continue;
          }

          const u = await mediaBlobUrl(apiUrl, m.id);
          if (cancelled) {
            if (u) URL.revokeObjectURL(u);
            continue;
          }

          if (u) {
            setMediaUrls((prev) => {
              if (prev[m.id]) {
                URL.revokeObjectURL(u);
                return prev;
              }

              const next = { ...prev, [m.id]: u };
              mediaUrlsRef.current = next;
              return next;
            });
          } else {
            failedMediaIdsRef.current.add(m.id);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, messages]);

  const sendText = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jid: chatId, message: trimmed }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      setText("");
      await loadLatest(false, false);
    } catch {
      setError("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const sendFile = async (file: File, type: "image" | "video" | "audio" | "voice") => {
    setSending(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("jid", chatId);
      fd.append("type", type);
      fd.append("file", file);
      const res = await fetch(`${apiUrl}/api/whatsapp/send-media`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      await loadLatest(false, false);
    } catch {
      setError("Failed to send media");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
        <Avatar className="size-11 border border-border/50 shadow-sm">
          <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
            {initialsFromTitle(title)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight text-foreground">{title}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={chatId}>
            {subtitle}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => void loadLatest(true, true)}
          disabled={loading}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sync
        </Button>
      </div>

      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <ScrollArea ref={scrollAreaRef} className="h-[min(52vh,420px)]">
        <div className="space-y-3 p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-8 animate-spin opacity-60" />
              <p className="text-sm">Loading conversation…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 py-14 text-center">
              <p className="text-sm font-medium text-foreground">No messages yet</p>
              <p className="mt-1 px-6 text-xs text-muted-foreground">
                Send a message below, or wait for history sync after linking this device.
              </p>
            </div>
          ) : (
            <>
              {hasMoreOlder && !loadingOlder ? (
                <div className="flex justify-center">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void loadOlder()}>
                    Load older messages
                  </Button>
                </div>
              ) : null}
              {loadingOlder ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-center text-xs text-muted-foreground">
                  Loading older messages...
                </div>
              ) : null}
              {messages.map((m) => {
                const mine = m.sender === "me";
                return (
                  <div key={m.id} className={cn("flex w-full gap-2", mine ? "justify-end" : "justify-start")}>
                    {!mine ? (
                      <Avatar className="mt-0.5 size-8 shrink-0 border border-border/40">
                        <AvatarFallback className="bg-muted text-[10px] font-medium">
                          {initialsFromTitle(title).slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                    ) : null}
                    <div
                      className={cn(
                        "max-w-[min(100%,520px)] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                        mine
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border border-border/60 bg-background"
                      )}
                    >
                      {m.hasMediaPayload && m.mediaKind === "image" && mediaUrls[m.id] ? (
                        <img
                          src={mediaUrls[m.id]}
                          alt=""
                          className="mb-2 max-h-52 max-w-full rounded-lg object-contain"
                        />
                      ) : null}
                      {m.hasMediaPayload && m.mediaKind === "video" && mediaUrls[m.id] ? (
                        <video
                          src={mediaUrls[m.id]}
                          controls
                          className="mb-2 max-h-52 max-w-full rounded-lg"
                        />
                      ) : null}
                      {m.hasMediaPayload &&
                      (m.mediaKind === "audio" || m.mediaKind === "voice") &&
                      mediaUrls[m.id] ? (
                        <audio src={mediaUrls[m.id]} controls className="mb-2 w-full max-w-70" />
                      ) : null}
                      <p className="whitespace-pre-wrap wrap-break-word leading-relaxed">{m.message}</p>
                      <p
                        className={cn(
                          "mt-1.5 text-[10px] tabular-nums",
                          mine ? "text-primary-foreground/75" : "text-muted-foreground"
                        )}
                      >
                        {new Date(m.timestamp).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>

      <Separator />

      <div className="space-y-3 bg-muted/15 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Paperclip className="size-3" />
            Attach
          </span>
          <Button type="button" variant="secondary" size="sm" className="h-8 gap-1 px-2 text-xs" asChild>
            <label className="cursor-pointer">
              <ImageIcon className="size-3.5" />
              Image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={sending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f, "image");
                }}
              />
            </label>
          </Button>
          <Button type="button" variant="secondary" size="sm" className="h-8 gap-1 px-2 text-xs" asChild>
            <label className="cursor-pointer">
              <Video className="size-3.5" />
              Video
              <input
                type="file"
                accept="video/*"
                className="hidden"
                disabled={sending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f, "video");
                }}
              />
            </label>
          </Button>
          <Button type="button" variant="secondary" size="sm" className="h-8 gap-1 px-2 text-xs" asChild>
            <label className="cursor-pointer">
              <Mic className="size-3.5" />
              Voice
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={sending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f, "voice");
                }}
              />
            </label>
          </Button>
          <Button type="button" variant="secondary" size="sm" className="h-8 gap-1 px-2 text-xs" asChild>
            <label className="cursor-pointer">
              Audio
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={sending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f, "audio");
                }}
              />
            </label>
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message…"
            className="h-11 flex-1 rounded-xl border-border/80 bg-background shadow-none"
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendText();
              }
            }}
          />
          <Button
            type="button"
            size="lg"
            className="h-11 shrink-0 rounded-xl px-5"
            onClick={() => void sendText()}
            disabled={sending || !text.trim()}
          >
            {sending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
