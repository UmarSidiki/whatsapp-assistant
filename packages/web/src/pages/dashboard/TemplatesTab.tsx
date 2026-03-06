import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Template {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

export function TemplatesTab({ apiUrl }: { apiUrl: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiUrl}/api/whatsapp/templates`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { if (data?.templates) setTemplates(data.templates); })
      .catch(() => {});
  }, [apiUrl]);

  const handleSave = async () => {
    setError("");
    if (!name.trim() || !content.trim()) return setError("Name and content are required.");
    const existing = templates.find(t => t.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return setError("A template with this name already exists.");
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), content: content.trim() }),
      });
      const data = await res.json();
      if (data?.template) {
        setTemplates((prev) => [...prev, data.template]);
        setName(""); setContent("");
      } else {
        setError(data?.error ?? "Failed to save template.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${apiUrl}/api/whatsapp/templates/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      setTemplates((prev) => prev.filter(t => t.id !== id));
    } catch {
      // silently ignore
    }
  };

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Extract {variables} from template
  const variables = [...new Set([...content.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New Template</CardTitle>
          <CardDescription>
            Save frequently used messages. Use <code className="text-xs">{"{name}"}</code>, <code className="text-xs">{"{word1}"}</code> etc. for variables.
            Templates are available in Bulk Messages and Schedule tabs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t-name">Template name</Label>
            <Input id="t-name" placeholder="Welcome message" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-content">Message content</Label>
            <Textarea
              id="t-content"
              placeholder={"Hello {name}! Welcome to our service.\n\nBest regards,\nThe Team"}
              rows={6}
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>
          {variables.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Variables detected: {variables.map(v => <code key={v} className="mr-1 rounded bg-muted px-1">{`{${v}}`}</code>)}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSave}>Save Template</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Templates</CardTitle>
          <CardDescription>{templates.length} template{templates.length !== 1 ? "s" : ""} (stored on server)</CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No templates saved yet.</p>
          ) : (
            <ScrollArea className="h-[420px] pr-2">
              <div className="space-y-3">
                {templates.map(t => (
                  <div key={t.id} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(t.content, t.id)}
                        >
                          {copied === t.id ? "Copied!" : "Copy"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(t.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">{t.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
