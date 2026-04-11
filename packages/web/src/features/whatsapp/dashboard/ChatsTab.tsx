import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bot,
  CalendarClock,
  Hash,
  Loader2,
  MessageCircle,
  Radio,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ApiResponseError, fetchJson } from "@/lib/api-utils";
import { cn } from "@/lib/utils";
import { WhatsAppThreadPanel, type ThreadMessage, type ThreadPageSeed } from "./WhatsAppThreadPanel";

type ChatType = "direct" | "group" | "broadcast" | "channel" | "unknown";
type DashboardTargetPage = "schedule" | "ai-assistant";

interface ChatItem {
  id: string;
  title: string;
  type: ChatType;
  target: string;
  contactId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  isPinned: boolean;
  isArchived: boolean;
  messageCount?: number;
}

interface BootstrapChatItem extends ChatItem {
  recentMessages: ThreadMessage[];
  hasMoreMessages: boolean;
  nextCursor?: string;
}

interface BootstrapChatsResponse {
  chats: BootstrapChatItem[];
  hasMore?: boolean;
  nextOffset?: number;
}

interface AIContact {
  phone: string;
  mimicMode: boolean;
}

interface ScheduledMessage {
  id: string;
  phone: string;
  status: "pending" | "sent" | "failed";
}

const CHAT_BOOTSTRAP_PAGE_SIZE = 50;

function normalizeTarget(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed;
}

function formatRelativeDate(iso?: string): string {
  if (!iso) return "No messages yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No messages yet";

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getTypeMeta(type: ChatType): { label: string; icon: React.ComponentType<{ className?: string }> } {
  switch (type) {
    case "direct":
      return { label: "Direct", icon: MessageCircle };
    case "group":
      return { label: "Group", icon: Users };
    case "broadcast":
      return { label: "Broadcast", icon: Radio };
    case "channel":
      return { label: "Channel", icon: Hash };
    default:
      return { label: "Chat", icon: MessageCircle };
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string; message?: string };
    if (typeof data.error === "string" && data.error) return data.error;
    if (typeof data.message === "string" && data.message) return data.message;
  } catch {
    // Keep fallback below when response body is not JSON.
  }
  return "Request failed";
}

export function ChatsTab({
  apiUrl,
  onNavigate,
}: {
  apiUrl: string;
  onNavigate?: (page: DashboardTargetPage) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [mimicByContact, setMimicByContact] = useState<Record<string, boolean>>({});
  const [seededThreads, setSeededThreads] = useState<Record<string, ThreadPageSeed>>({});
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [nextChatsOffset, setNextChatsOffset] = useState(0);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledMessage[]>([]);
  const [mimicSaving, setMimicSaving] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const loadSchedules = async () => {
    try {
      const rows = await fetchJson<ScheduledMessage[]>(`${apiUrl}/api/whatsapp/schedule`, {
        credentials: "include",
      });
      setSchedules(Array.isArray(rows) ? rows : []);
    } catch {
      setSchedules([]);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const [bootstrapPayload, contactsPayload] = await Promise.all([
        fetchJson<BootstrapChatsResponse>(
          `${apiUrl}/api/whatsapp/chats/bootstrap?type=direct&chatLimit=${CHAT_BOOTSTRAP_PAGE_SIZE}&threadLimit=20&offset=0`,
          {
            credentials: "include",
          }
        ),
        fetchJson<{ contacts: AIContact[] }>(`${apiUrl}/api/ai/contacts`, {
          credentials: "include",
        }).catch(() => ({ contacts: [] })),
      ]);

      const bootstrapChats = Array.isArray(bootstrapPayload.chats) ? bootstrapPayload.chats : [];

      const seeded: Record<string, ThreadPageSeed> = {};
      for (const chat of bootstrapChats) {
        seeded[chat.id] = {
          messages: Array.isArray(chat.recentMessages) ? chat.recentMessages : [],
          hasMore: Boolean(chat.hasMoreMessages),
          nextCursor: chat.nextCursor,
        };
      }
      setSeededThreads(seeded);

      setHasMoreChats(Boolean(bootstrapPayload.hasMore));
      setNextChatsOffset(
        typeof bootstrapPayload.nextOffset === "number"
          ? bootstrapPayload.nextOffset
          : bootstrapChats.length
      );

      const directChats = bootstrapChats.map<ChatItem>((chat) => ({
        id: chat.id,
        title: chat.title,
        type: chat.type,
        target: chat.target,
        contactId: chat.contactId,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt,
        unreadCount: chat.unreadCount,
        isPinned: chat.isPinned,
        isArchived: chat.isArchived,
        messageCount: chat.messageCount,
      }));

      setChats(directChats);

      setSelectedId((prev) => {
        if (prev && directChats.some((chat) => chat.id === prev)) return prev;
        return directChats[0]?.id ?? "";
      });

      const mimicMap: Record<string, boolean> = {};
      for (const contact of contactsPayload.contacts ?? []) {
        mimicMap[normalizeTarget(contact.phone)] = Boolean(contact.mimicMode);
      }
      setMimicByContact(mimicMap);
      await loadSchedules();
    } catch (e) {
      if (e instanceof ApiResponseError) {
        setError(e.message);
      } else {
        setError("Failed to load chats");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  const handleLoadMoreChats = async () => {
    if (loadingMoreChats || !hasMoreChats) return;

    setLoadingMoreChats(true);
    try {
      const payload = await fetchJson<BootstrapChatsResponse>(
        `${apiUrl}/api/whatsapp/chats/bootstrap?type=direct&chatLimit=${CHAT_BOOTSTRAP_PAGE_SIZE}&threadLimit=20&offset=${nextChatsOffset}`,
        {
          credentials: "include",
        }
      );

      const rows = Array.isArray(payload.chats) ? payload.chats : [];
      if (rows.length > 0) {
        const seededChunk: Record<string, ThreadPageSeed> = {};
        const mappedRows = rows.map<ChatItem>((chat) => {
          seededChunk[chat.id] = {
            messages: Array.isArray(chat.recentMessages) ? chat.recentMessages : [],
            hasMore: Boolean(chat.hasMoreMessages),
            nextCursor: chat.nextCursor,
          };

          return {
            id: chat.id,
            title: chat.title,
            type: chat.type,
            target: chat.target,
            contactId: chat.contactId,
            lastMessage: chat.lastMessage,
            lastMessageAt: chat.lastMessageAt,
            unreadCount: chat.unreadCount,
            isPinned: chat.isPinned,
            isArchived: chat.isArchived,
            messageCount: chat.messageCount,
          };
        });

        setSeededThreads((prev) => ({ ...prev, ...seededChunk }));
        setChats((prev) => {
          const byId = new Map(prev.map((chat) => [chat.id, chat]));
          for (const chat of mappedRows) {
            const existing = byId.get(chat.id);
            byId.set(chat.id, existing ? { ...existing, ...chat } : chat);
          }
          return [...byId.values()];
        });
      }

      setHasMoreChats(Boolean(payload.hasMore));
      setNextChatsOffset(
        typeof payload.nextOffset === "number"
          ? payload.nextOffset
          : nextChatsOffset + rows.length
      );
    } catch (e) {
      if (e instanceof ApiResponseError) {
        setError(e.message);
      } else {
        setError("Failed to load more chats");
      }
    } finally {
      setLoadingMoreChats(false);
    }
  };

  const filteredChats = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return chats;
    return chats.filter((chat) => {
      return (
        chat.title.toLowerCase().includes(search) ||
        chat.target.toLowerCase().includes(search) ||
        (chat.lastMessage?.toLowerCase().includes(search) ?? false)
      );
    });
  }, [chats, query]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedId),
    [chats, selectedId]
  );

  const selectedContactKey = selectedChat?.contactId
    ? normalizeTarget(selectedChat.contactId)
    : "";
  const selectedTargetKey = selectedChat ? normalizeTarget(selectedChat.target) : "";
  const isDirectChat = selectedChat?.type === "direct" && Boolean(selectedContactKey);
  const isMimicEnabled = isDirectChat ? Boolean(mimicByContact[selectedContactKey]) : false;
  const pendingScheduleCount = selectedTargetKey
    ? schedules.filter(
        (row) =>
          row.status === "pending" &&
          normalizeTarget(row.phone) === selectedTargetKey
      ).length
    : 0;

  const handleMimicToggle = async (enabled: boolean) => {
    if (!selectedChat || !selectedContactKey || !isDirectChat) return;

    setMimicSaving(true);
    setActionError("");
    setActionSuccess("");

    try {
      const response = await fetch(`${apiUrl}/api/ai/mimic-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contactId: selectedContactKey, enabled }),
      });

      if (!response.ok) {
        setActionError(await readErrorMessage(response));
        return;
      }

      setMimicByContact((prev) => ({ ...prev, [selectedContactKey]: enabled }));
      setActionSuccess(`AI Assistant ${enabled ? "enabled" : "disabled"} for this chat.`);
    } catch {
      setActionError("Failed to update AI Assistant setting");
    } finally {
      setMimicSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!selectedChat) return;

    setActionError("");
    setActionSuccess("");

    if (!scheduleMessage.trim() || !scheduleAt) {
      setActionError("Enter message and schedule time.");
      return;
    }

    setScheduleSaving(true);
    try {
      const response = await fetch(`${apiUrl}/api/whatsapp/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone: selectedChat.target,
          message: scheduleMessage.trim(),
          scheduledAt: new Date(scheduleAt).toISOString(),
        }),
      });

      if (!response.ok) {
        setActionError(await readErrorMessage(response));
        return;
      }

      setActionSuccess("Message scheduled from Chats.");
      setScheduleMessage("");
      setScheduleAt("");
      await loadSchedules();
    } catch {
      setActionError("Failed to schedule message");
    } finally {
      setScheduleSaving(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <Card className="wa-card">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>Chats</CardTitle>
            <CardDescription>
              View your 1:1 WhatsApp conversations and manage apps per chat.
            </CardDescription>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search chats..."
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="wa-skeleton h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="mr-2 size-4" />
                Retry
              </Button>
            </div>
          ) : filteredChats.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No chats found.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredChats.map((chat) => {
                const { label, icon: TypeIcon } = getTypeMeta(chat.type);
                const active = selectedId === chat.id;

                return (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedId(chat.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-background hover:bg-muted/70"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="size-4 shrink-0 text-muted-foreground" />
                          <p className="truncate text-sm font-semibold text-foreground">{chat.title}</p>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            {label}
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {chat.lastMessage || "No message preview"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[11px] text-muted-foreground">
                          {formatRelativeDate(chat.lastMessageAt)}
                        </span>
                        {chat.unreadCount > 0 && (
                          <Badge className="h-5 min-w-5 px-1.5 text-[10px]">
                            {chat.unreadCount}
                          </Badge>
                        )}
                        {(chat.isPinned || chat.isArchived) && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            {chat.isPinned && <span className="text-[10px]">PIN</span>}
                            {chat.isArchived && <Archive className="size-3" />}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {hasMoreChats ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => void handleLoadMoreChats()}
                  disabled={loadingMoreChats}
                >
                  {loadingMoreChats ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Loading more chats...
                    </>
                  ) : (
                    "Load more chats"
                  )}
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        {selectedChat ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {getTypeMeta(selectedChat.type).label} · {selectedChat.target}
            </p>
            <WhatsAppThreadPanel
              apiUrl={apiUrl}
              chatId={selectedChat.id}
              title={selectedChat.title}
              initialPage={seededThreads[selectedChat.id]}
            />
          </div>
        ) : (
          <Card className="wa-card">
            <CardHeader>
              <CardTitle>Select a chat</CardTitle>
              <CardDescription>
                Choose a chat from the list to open the conversation and manage apps.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card className="wa-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              AI Assistant
            </CardTitle>
            <CardDescription>Quick per-chat AI control.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedChat ? (
              isDirectChat ? (
                <>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Mimic mode</p>
                      <p className="text-xs text-muted-foreground">
                        AI replies using your style for this contact.
                      </p>
                    </div>
                    <Switch
                      checked={isMimicEnabled}
                      disabled={mimicSaving}
                      onCheckedChange={(checked) => void handleMimicToggle(checked)}
                    />
                  </div>
                  <Button variant="outline" onClick={() => onNavigate?.("ai-assistant")}>
                    Open full AI Assistant settings
                  </Button>
                </>
              ) : (
                <div className="space-y-3 rounded-lg border border-dashed p-3">
                  <p className="text-sm text-muted-foreground">
                    AI mimic controls are available for direct chats.
                  </p>
                  <Button variant="outline" onClick={() => onNavigate?.("ai-assistant")}>
                    Open full AI Assistant settings
                  </Button>
                </div>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Select a chat to manage AI.</p>
            )}
          </CardContent>
        </Card>

        <Card className="wa-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-5" />
              Scheduled Messages
            </CardTitle>
            <CardDescription>Quick scheduling for the selected chat.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedChat ? (
              <>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm font-medium">Pending in this chat</span>
                  <Badge variant="outline">{pendingScheduleCount}</Badge>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="chat-schedule-time">Send at</Label>
                  <Input
                    id="chat-schedule-time"
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="chat-schedule-message">Message</Label>
                  <Textarea
                    id="chat-schedule-message"
                    rows={3}
                    placeholder="Write a message to schedule..."
                    value={scheduleMessage}
                    onChange={(e) => setScheduleMessage(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void handleSchedule()} disabled={scheduleSaving}>
                    {scheduleSaving ? "Scheduling..." : "Schedule from Chats"}
                  </Button>
                  <Button variant="outline" onClick={() => onNavigate?.("schedule")}>
                    Open full Scheduled tab
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a chat to schedule a message.</p>
            )}
          </CardContent>
        </Card>

        {(actionError || actionSuccess) && (
          <div
            className={cn(
              "rounded-lg border p-3 text-sm",
              actionError
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/30 bg-primary/5 text-primary"
            )}
          >
            {actionError || actionSuccess}
          </div>
        )}
      </div>
    </div>
  );
}
