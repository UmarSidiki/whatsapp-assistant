import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AutoReplyRule {
  id: string;
  keyword: string;
  response: string;
  matchType: "exact" | "contains" | "startsWith";
  enabled: boolean;
}

const MATCH_LABELS = { exact: "Exact match", contains: "Contains", startsWith: "Starts with" };

export function AutoReplyTab({ apiUrl }: { apiUrl: string }) {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [keyword, setKeyword] = useState("");
  const [response, setResponse] = useState("");
  const [matchType, setMatchType] = useState<AutoReplyRule["matchType"]>("contains");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const res = await fetch(`${apiUrl}/api/whatsapp/auto-reply`, { credentials: "include" });
    setRules(await res.json());
  };

  useEffect(() => { load(); }, [apiUrl]);

  const handleAdd = async () => {
    setError("");
    if (!keyword.trim() || !response.trim()) return setError("Keyword and response are required.");
    setLoading(true);
    const res = await fetch(`${apiUrl}/api/whatsapp/auto-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ keyword, response, matchType }),
    });
    setLoading(false);
    if (!res.ok) return setError("Failed to add rule.");
    setKeyword(""); setResponse("");
    load();
  };

  const handleToggle = async (rule: AutoReplyRule) => {
    await fetch(`${apiUrl}/api/whatsapp/auto-reply/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    load();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${apiUrl}/api/whatsapp/auto-reply/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    load();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Auto-Reply Rule</CardTitle>
          <CardDescription>
            When an incoming message matches the keyword, the bot automatically replies.
            WhatsApp must be connected for auto-replies to work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ar-keyword">Keyword</Label>
              <Input id="ar-keyword" placeholder="hello" value={keyword} onChange={e => setKeyword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Match type</Label>
              <Select value={matchType} onValueChange={(v) => setMatchType(v as AutoReplyRule["matchType"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">Exact match</SelectItem>
                  <SelectItem value="contains">Contains</SelectItem>
                  <SelectItem value="startsWith">Starts with</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ar-response">Auto-reply message</Label>
            <Textarea id="ar-response" placeholder="Hi! Thanks for your message…" rows={3} value={response} onChange={e => setResponse(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleAdd} disabled={loading}>Add Rule</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Rules</CardTitle>
          <CardDescription>{rules.length} rule{rules.length !== 1 ? "s" : ""} configured</CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No auto-reply rules yet.</p>
          ) : (
            <div className="divide-y">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-medium">{rule.keyword}</code>
                      <Badge variant="outline" className="text-xs">{MATCH_LABELS[rule.matchType]}</Badge>
                      {!rule.enabled && <Badge variant="secondary">Disabled</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{rule.response}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggle(rule)}
                      title={rule.enabled ? "Disable rule" : "Enable rule"}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(rule.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
