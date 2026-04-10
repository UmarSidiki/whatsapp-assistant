"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
}: {
  apiUrl: string;
  chatId: string;
  title: string;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});

  const subtitle = useMemo(() => {
    const t = chatId.trim();
    if (t.length <= 42) return t;
    return `${t.slice(0, 20)}…${t.slice(-18)}`;
  }, [chatId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = `${apiUrl}/api/whatsapp/chats/${encodeURIComponent(chatId)}/messages`;
      const data = await fetchJson<{ messages: ThreadMessage[] }>(url, {
        credentials: "include",
      });
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) {
      if (e instanceof ApiResponseError) {
        setError(e.message);
      } else {
        setError("Failed to load messages");
      }
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      for (const u of Object.values(mediaUrls)) {
        URL.revokeObjectURL(u);
      }
    };
  }, [mediaUrls]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (!m.hasMediaPayload || !m.mediaKind) continue;
        if (
          m.mediaKind === "image" ||
          m.mediaKind === "video" ||
          m.mediaKind === "sticker" ||
          m.mediaKind === "audio" ||
          m.mediaKind === "voice"
        ) {
          const u = await mediaBlobUrl(apiUrl, m.id);
          if (u && !cancelled) next[m.id] = u;
        }
      }
      if (!cancelled) {
        setMediaUrls((prev) => {
          for (const u of Object.values(prev)) {
            URL.revokeObjectURL(u);
          }
          return next;
        });
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
      await load();
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
      await load();
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
          onClick={() => void load()}
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

      <ScrollArea className="h-[min(52vh,420px)]">
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
            messages.map((m) => {
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
                      <audio src={mediaUrls[m.id]} controls className="mb-2 w-full max-w-[280px]" />
                    ) : null}
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
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
            })
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
