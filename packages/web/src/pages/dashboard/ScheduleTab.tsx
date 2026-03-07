import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ScheduledMessage {
  id: string;
  phone: string;
  message: string;
  scheduledAt: string;
  status: "pending" | "sent" | "failed";
}

interface Template {
  id: string;
  name: string;
  content: string;
}

function parseTemplatesPayload(data: unknown): Template[] {
  if (Array.isArray(data)) return data as Template[];
  if (data && typeof data === "object" && Array.isArray((data as { templates?: unknown[] }).templates)) {
    return (data as { templates: Template[] }).templates;
  }
  return [];
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  sent: "default",
  failed: "destructive",
};

function localToISO(local: string) {
  return new Date(local).toISOString();
}

function isoToLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minDateTime() {
  const now = new Date(Date.now() + 60_000);
  return isoToLocal(now.toISOString());
}

export function ScheduleTab({ apiUrl }: { apiUrl: string }) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

  const load = async () => {
    const res = await fetch(`${apiUrl}/api/whatsapp/schedule`, { credentials: "include" });
    const data = await res.json();
    setMessages(data);
  };

  useEffect(() => {
    load();
    // Load saved templates
    fetch(`${apiUrl}/api/whatsapp/templates`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setTemplates(parseTemplatesPayload(data)))
      .catch(() => {});
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  const handleSchedule = async () => {
    setError("");
    if (!phone || !message || !scheduledAt) return setError("All fields are required.");
    setLoading(true);
    const res = await fetch(`${apiUrl}/api/whatsapp/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ phone, message, scheduledAt: localToISO(scheduledAt) }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      return setError(data.error ?? "Failed to schedule");
    }
    setPhone(""); setMessage(""); setScheduledAt("");
    load();
  };

  const handleCancel = async (id: string) => {
    await fetch(`${apiUrl}/api/whatsapp/schedule/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    load();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Schedule a Message</CardTitle>
          <CardDescription>Messages are sent at the exact scheduled time (server must be running).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="s-phone">Phone number</Label>
              <Input id="s-phone" placeholder="+1234567890" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-time">Schedule date & time</Label>
              <Input
                id="s-time"
                type="datetime-local"
                min={minDateTime()}
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-msg">Message</Label>
            {templates.length > 0 && (
              <Select onValueChange={(id) => {
                const t = templates.find((t) => t.id === id);
                if (t) setMessage(t.content);
              }}>
                <SelectTrigger className="mb-2">
                  <SelectValue placeholder="Load from template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Textarea id="s-msg" placeholder="Type your message…" rows={4} value={message} onChange={e => setMessage(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSchedule} disabled={loading}>
            {loading ? "Scheduling…" : "Schedule Message"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled Messages</CardTitle>
          <CardDescription>{messages.length} message{messages.length !== 1 ? "s" : ""} scheduled</CardDescription>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No scheduled messages.</p>
          ) : (
            <div className="divide-y">
              {messages.map((msg) => (
                <div key={msg.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{msg.phone}</span>
                      <Badge variant={STATUS_VARIANTS[msg.status]}>{msg.status}</Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground max-w-xs">{msg.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(msg.scheduledAt).toLocaleString()}
                    </p>
                  </div>
                  {msg.status === "pending" && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0" onClick={() => handleCancel(msg.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
