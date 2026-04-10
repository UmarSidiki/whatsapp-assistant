import { useEffect, useMemo, useState } from "react";
import { Hash, Radio, RefreshCw, Search, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiResponseError, fetchJson } from "@/lib/api-utils";
import { cn } from "@/lib/utils";
import { WhatsAppThreadPanel } from "./WhatsAppThreadPanel";

type ChatType = "group" | "broadcast" | "channel";

interface CommunityChat {
  id: string;
  title: string;
  type: ChatType;
  lastMessage?: string;
  lastMessageAt?: string;
  messageCount: number;
}

function getIcon(type: ChatType) {
  switch (type) {
    case "group":
      return Users;
    case "broadcast":
      return Radio;
    case "channel":
      return Hash;
    default:
      return Users;
  }
}

function formatRelativeDate(iso?: string): string {
  if (!iso) return "No messages yet";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "No messages yet";
  const diffMinutes = Math.floor((Date.now() - ts) / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function CommunitiesTab({ apiUrl }: { apiUrl: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<CommunityChat[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const payload = await fetchJson<{ chats: CommunityChat[] }>(
        `${apiUrl}/api/whatsapp/chats?type=communities`,
        { credentials: "include" }
      );
      const list = Array.isArray(payload.chats) ? payload.chats : [];
      setChats(list);
      setSelectedId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
    } catch (error) {
      if (error instanceof ApiResponseError) {
        setError(error.message);
      } else {
        setError("Failed to load communities");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  const selected = useMemo(
    () => chats.find((c) => c.id === selectedId),
    [chats, selectedId]
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return chats;
    return chats.filter((chat) => {
      return (
        chat.title.toLowerCase().includes(search) ||
        chat.id.toLowerCase().includes(search) ||
        (chat.lastMessage?.toLowerCase().includes(search) ?? false)
      );
    });
  }, [chats, query]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <Card className="wa-card">
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>Communities</CardTitle>
          <CardDescription>
            Groups, broadcast, and channel conversations from your WhatsApp history.
          </CardDescription>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search communities..."
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
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No communities found.
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((chat) => {
              const Icon = getIcon(chat.type);
              const active = selectedId === chat.id;
              return (
                <button
                  type="button"
                  key={chat.id}
                  onClick={() => setSelectedId(chat.id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active ? "border-primary/40 bg-primary/10" : "border-border bg-background hover:bg-muted/70"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <p className="truncate text-sm font-semibold text-foreground">{chat.title}</p>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          {chat.type}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {chat.lastMessage || "No message preview"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-muted-foreground">{formatRelativeDate(chat.lastMessageAt)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {chat.messageCount.toLocaleString()} messages
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>

    {selected ? (
      <WhatsAppThreadPanel apiUrl={apiUrl} chatId={selected.id} title={selected.title} />
    ) : (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Select a community chat to send and view messages.
      </p>
    )}
    </div>
  );
}

