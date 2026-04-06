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

function localToISO(local: string, timezoneOffset: number = 0) {
  // Parse the local datetime string (format: YYYY-MM-DDTHH:mm)
  const date = new Date(local);
  // Adjust for timezone offset (timezoneOffset is in minutes, positive for ahead of UTC)
  const adjusted = new Date(date.getTime() - timezoneOffset * 60000);
  return adjusted.toISOString();
}

function isoToLocal(iso: string, timezoneOffset: number = 0) {
  const d = new Date(iso);
  // Adjust for timezone offset to show local time
  const adjusted = new Date(d.getTime() + timezoneOffset * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${adjusted.getUTCFullYear()}-${pad(adjusted.getUTCMonth() + 1)}-${pad(adjusted.getUTCDate())}T${pad(adjusted.getUTCHours())}:${pad(adjusted.getUTCMinutes())}`;
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
  const [timezoneOffset, setTimezoneOffset] = useState(0);

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

    // Load timezone from AI settings
    fetch(`${apiUrl}/api/ai/settings`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: any) => {
        if (data.timezone) {
          // Timezone is stored as offset string like "+05:30" or "-08:00"
          const tzStr = data.timezone;
          const match = tzStr.match(/^([+-])?(\d{1,2}):?(\d{2})?$/);
          if (match) {
            const sign = match[1] === '-' ? -1 : 1;
            const hours = parseInt(match[2] || "0", 10);
            const minutes = parseInt(match[3] || "0", 10);
            const offset = sign * (hours * 60 + minutes);
            setTimezoneOffset(offset);
          } else {
            // fallback
            setTimezoneOffset(parseFloat(tzStr) * 60 || 0);
          }
        }
      })
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
      body: JSON.stringify({ phone, message, scheduledAt: localToISO(scheduledAt, timezoneOffset) }),
    });
    setLoading(false);
    if (!res.ok) {
      const data: any = await res.json();
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
          <CardTitle>📋 Reminder Standard</CardTitle>
          <CardDescription>Quick reference for using the reminder system</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium mb-2">Send Reminders via WhatsApp Commands:</p>
            <ul className="space-y-2 ml-4 list-disc text-muted-foreground">
              <li><code className="bg-muted px-2 py-1 rounded">remind me to [task] in [time] [unit]</code></li>
              <p className="text-xs mt-1">Example: "remind me to call John in 5 minutes"</p>
              <li><code className="bg-muted px-2 py-1 rounded">remind me to [task] at [time]</code></li>
              <p className="text-xs mt-1">Example: "remind me to pay bill at 3pm" or "remind me to call at 15:30"</p>
              <li><code className="bg-muted px-2 py-1 rounded">[time] [unit] baad [task] yaad dilaana</code> (Hindi)</li>
              <p className="text-xs mt-1">Example: "5 minute baad mujhe lights band karne ki yaad dilaana"</p>
            </ul>
          </div>
          <div>
            <p className="font-medium mb-2">Supported Time Units:</p>
            <p className="text-muted-foreground">seconds, minutes, hours, days (or s, m, h, d)</p>
          </div>
          <div>
            <p className="font-medium mb-2">Dashboard Method:</p>
            <p className="text-muted-foreground">Use the form below to schedule messages for specific dates and times.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule a Message</CardTitle>
          <CardDescription>Messages are sent at the exact scheduled time (server must be running).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="s-phone">Phone number</Label>
              <Input id="s-phone" placeholder="+1234567890" value={phone} onChange={(e: any) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-time">Schedule date & time</Label>
              <Input
                id="s-time"
                type="datetime-local"
                min={minDateTime()}
                value={scheduledAt}
                onChange={(e: any) => setScheduledAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-msg">Message</Label>
            {templates.length > 0 && (
              <Select onValueChange={(id: string) => {
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
            <Textarea id="s-msg" placeholder="Type your message…" rows={4} value={message} onChange={(e: any) => setMessage(e.target.value)} />
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
