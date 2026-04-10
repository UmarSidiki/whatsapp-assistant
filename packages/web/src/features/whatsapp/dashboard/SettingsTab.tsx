import { useEffect, useState } from "react";
import { Save, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiResponseError, fetchJson } from "@/lib/api-utils";

const MIN_LIMIT = 100;
const MAX_LIMIT = 10000;

interface WhatsAppSettingsPayload {
  historyLimit: number;
}

export function SettingsTab({ apiUrl }: { apiUrl: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(1000);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const settings = await fetchJson<WhatsAppSettingsPayload>(
        `${apiUrl}/api/whatsapp/settings`,
        { credentials: "include" }
      );
      setHistoryLimit(settings.historyLimit);
    } catch (error) {
      if (error instanceof ApiResponseError) {
        setError(error.message);
      } else {
        setError("Failed to load settings");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  const saveSettings = async () => {
    setError("");
    setSuccess("");

    if (!Number.isInteger(historyLimit) || historyLimit < MIN_LIMIT || historyLimit > MAX_LIMIT) {
      setError(`History limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}.`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/api/whatsapp/settings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyLimit }),
      });

      if (!response.ok) {
        const message = await response.text();
        setError(message || "Failed to save settings");
        return;
      }

      setSuccess("Settings saved.");
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="wa-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="size-5" />
          Chat Settings
        </CardTitle>
        <CardDescription>
          Control how many recent messages are kept per chat in the database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="wa-skeleton h-24 w-full rounded-xl" />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="history-limit">Per-chat history limit</Label>
            <Input
              id="history-limit"
              type="number"
              min={MIN_LIMIT}
              max={MAX_LIMIT}
              step={1}
              value={historyLimit}
              onChange={(e) => setHistoryLimit(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Default is 1000. The system keeps only the newest messages per chat.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
            {success}
          </div>
        )}

        <Button onClick={() => void saveSettings()} disabled={loading || saving}>
          <Save className="mr-2 size-4" />
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

