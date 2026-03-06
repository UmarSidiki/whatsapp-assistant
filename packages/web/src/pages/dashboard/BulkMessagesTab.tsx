import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BulkJob {
  total: number;
  sent: number;
  failed: number;
  running: boolean;
  errors: Array<{ phone: string; error: string }>;
}

interface BulkContact {
  phone: string;
  [key: string]: string;
}

interface Template {
  id: string;
  name: string;
  content: string;
}

function parseContacts(raw: string): BulkContact[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [phone, name, ...rest] = line.split(",").map((p) => p.trim());
      const obj: BulkContact = { phone };
      if (name) obj.name = name;
      rest.forEach((v, i) => { obj[`word${i + 1}`] = v; });
      return obj;
    });
}

function interpolatePreview(tpl: string, contacts: BulkContact[]): string {
  if (!contacts.length) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => contacts[0][k] ?? `{${k}}`);
}

export function BulkMessagesTab({ apiUrl }: { apiUrl: string }) {
  const [contactsRaw, setContactsRaw] = useState("");
  const [template, setTemplate] = useState("");
  const [antiBan, setAntiBan] = useState(true);
  const [minDelay, setMinDelay] = useState(3);
  const [maxDelay, setMaxDelay] = useState(10);
  const [job, setJob] = useState<BulkJob | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);

  const contacts = parseContacts(contactsRaw);
  const preview = interpolatePreview(template, contacts);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => {
    // Load saved templates
    fetch(`${apiUrl}/api/whatsapp/templates`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { if (data?.templates) setTemplates(data.templates); })
      .catch(() => {});
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollStatus = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${apiUrl}/api/whatsapp/bulk-status`, { credentials: "include" });
      const data: BulkJob = await res.json();
      setJob(data);
      if (!data.running) stopPolling();
    }, 2000);
  };

  const handleStart = async () => {
    setError("");
    if (!contacts.length) return setError("No contacts to send to.");
    if (!template.trim()) return setError("Message template is empty.");
    const res = await fetch(`${apiUrl}/api/whatsapp/bulk-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        contacts,
        messageTemplate: template,
        antiBan,
        minDelay: minDelay * 1000,
        maxDelay: maxDelay * 1000,
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Failed to start");
    setJob({ total: data.total, sent: 0, failed: 0, running: true, errors: [] });
    pollStatus();
  };

  const handleStop = async () => {
    await fetch(`${apiUrl}/api/whatsapp/bulk-stop`, { method: "POST", credentials: "include" });
    stopPolling();
    setJob((j) => j ? { ...j, running: false } : j);
  };

  const progress = job ? Math.round(((job.sent + job.failed) / Math.max(job.total, 1)) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
            <CardDescription>
              One per line: <code className="text-xs">phone,name,word1,word2</code>
              <br />
              Variables available in template: <code className="text-xs">{"{name}"}</code>, <code className="text-xs">{"{word1}"}</code>, <code className="text-xs">{"{word2}"}</code>…
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={"+1234567890,John,Special Offer\n+0987654321,Jane,Discount\n+1122334455"}
              rows={8}
              value={contactsRaw}
              onChange={(e) => setContactsRaw(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {contacts.length} contact{contacts.length !== 1 ? "s" : ""} loaded
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Message Template</CardTitle>
            <CardDescription>Use <code className="text-xs">{"{name}"}</code>, <code className="text-xs">{"{word1}"}</code> for personalisation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {templates.length > 0 && (
              <div className="space-y-2">
                <Label>Load from saved templates</Label>
                <Select onValueChange={(id) => {
                  const t = templates.find((t) => t.id === id);
                  if (t) setTemplate(t.content);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Textarea
              placeholder={"Hello {name}, we have a {word1} just for you! 🎉"}
              rows={5}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
            {template && contacts.length > 0 && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Preview (first contact):</p>
                <p className="whitespace-pre-wrap">{preview}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Anti-Ban Settings</CardTitle>
          <CardDescription>Adds random delays between messages to reduce ban risk.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch id="anti-ban" checked={antiBan} onCheckedChange={setAntiBan} />
            <Label htmlFor="anti-ban" className="cursor-pointer">
              Anti-ban protection {antiBan ? <Badge variant="default" className="ml-1">ON</Badge> : <Badge variant="secondary" className="ml-1">OFF</Badge>}
            </Label>
          </div>
          {antiBan && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="min-delay">Min delay (seconds)</Label>
                <Input
                  id="min-delay"
                  type="number"
                  min={1}
                  max={60}
                  value={minDelay}
                  onChange={(e) => setMinDelay(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-delay">Max delay (seconds)</Label>
                <Input
                  id="max-delay"
                  type="number"
                  min={1}
                  max={120}
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {job && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Send Progress</CardTitle>
              <Badge variant={job.running ? "default" : "secondary"}>
                {job.running ? "Running…" : "Finished"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progress} className="h-3" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{job.sent + job.failed} / {job.total} processed</span>
              <span className="text-green-600">{job.sent} sent</span>
              {job.failed > 0 && <span className="text-destructive">{job.failed} failed</span>}
            </div>
            {job.errors.length > 0 && (
              <ScrollArea className="h-32 rounded-md border p-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Errors:</p>
                {job.errors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive">{e.phone}: {e.error}</p>
                ))}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={handleStart} disabled={job?.running}>
          {job?.running ? "Sending…" : "Start Sending"}
        </Button>
        {job?.running && (
          <Button variant="destructive" onClick={handleStop}>Stop</Button>
        )}
      </div>
    </div>
  );
}
