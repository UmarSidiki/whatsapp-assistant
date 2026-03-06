import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Clock, RotateCcw, Eye, EyeOff, Zap } from "lucide-react";

type Provider = "groq" | "gemini";
type ContactStatus = "ready" | "mimicking" | "error";

interface AISettings {
  enabled: boolean;
  primaryProvider: Provider;
  fallbackProvider: Provider;
}

interface UsageStats {
  groq: { used: number; limit: number };
  gemini: { used: number; limit: number };
  lastUpdated: string;
  resetTime?: string;
}

interface Contact {
  id: string;
  phone: string;
  name: string;
  messageCount: number;
  lastMessageDate?: string;
  mimicMode: boolean;
  status: ContactStatus;
  personaLastRefresh?: string;
}

interface APITestResult {
  success: boolean;
  timestamp: string;
  provider: Provider;
  message: string;
}

/**
 * AI Assistant Dashboard Tab Component
 * Manages AI settings, API configuration, contact controls, and usage statistics
 */
export function AIAssistantTab({ apiUrl }: { apiUrl: string }) {
  // Main settings state
  const [settings, setSettings] = useState<AISettings>({
    enabled: false,
    primaryProvider: "groq",
    fallbackProvider: "gemini",
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");

  // Usage stats state
  const [usage, setUsage] = useState<UsageStats>({
    groq: { used: 0, limit: 27 },
    gemini: { used: 0, limit: 54 },
    lastUpdated: new Date().toISOString(),
  });

  // Contacts and per-contact settings
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // API test state
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<APITestResult | null>(null);

  // Modals state
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [personaData, setPersonaData] = useState<string>("");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial data
  useEffect(() => {
    loadSettings();
    loadContacts();
    loadUsageStats();

    // Auto-refresh stats every 30 seconds
    const interval = setInterval(loadUsageStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/settings`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setSettingsError("");
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadContacts = async () => {
    setContactsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/ai/history`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        if (data.contacts?.length > 0) {
          setSelectedContactId(data.contacts[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load contacts:", err);
    } finally {
      setContactsLoading(false);
    }
  };

  const loadUsageStats = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/usage`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUsage({
          groq: data.groq || { used: 0, limit: 27 },
          gemini: data.gemini || { used: 0, limit: 54 },
          lastUpdated: new Date().toISOString(),
          resetTime: data.resetTime,
        });
      }
    } catch (err) {
      console.error("Failed to load usage stats:", err);
    }
  };

  const handleSettingsSave = async () => {
    setSettingsSaving(true);
    setSettingsError("");
    setSettingsSuccess("");

    try {
      const res = await fetch(`${apiUrl}/api/ai/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        setSettingsSuccess("Settings saved successfully");
        setTimeout(() => setSettingsSuccess(""), 3000);
      } else {
        throw new Error("Failed to save settings");
      }
    } catch (err) {
      setSettingsError("Error saving settings. Please try again.");
      console.error(err);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleTestAPI = async (provider: Provider) => {
    setTestLoading(true);
    setTestResult(null);

    try {
      const res = await fetch(`${apiUrl}/api/ai/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider }),
      });

      const data = await res.json();
      setTestResult({
        success: res.ok,
        timestamp: new Date().toLocaleString(),
        provider,
        message: data.message || (res.ok ? "Connection successful" : "Connection failed"),
      });
    } catch (err) {
      setTestResult({
        success: false,
        timestamp: new Date().toLocaleString(),
        provider,
        message: "Network error - could not reach API",
      });
      console.error(err);
    } finally {
      setTestLoading(false);
    }
  };

  const handleRefreshPersona = async (contactId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/refresh-persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contactId }),
      });

      if (res.ok) {
        // Update the contact's persona refresh time
        setContacts((prev) =>
          prev.map((c) =>
            c.id === contactId
              ? { ...c, personaLastRefresh: new Date().toISOString() }
              : c
          )
        );
      }
    } catch (err) {
      console.error("Failed to refresh persona:", err);
    }
  };

  const handleToggleMimicMode = async (contactId: string, enabled: boolean) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/mimic-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contactId, enabled }),
      });

      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.id === contactId ? { ...c, mimicMode: enabled } : c))
        );
      }
    } catch (err) {
      console.error("Failed to toggle mimic mode:", err);
    }
  };

  const handleViewPersona = async (contactId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/persona/${contactId}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setPersonaData(JSON.stringify(data, null, 2));
        setPersonaModalOpen(true);
      }
    } catch (err) {
      console.error("Failed to load persona:", err);
    }
  };

  const handleViewHistory = async (contactId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/history/${contactId}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data.messages || []);
        setHistoryModalOpen(true);
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  const handleRefreshAllPersonas = async () => {
    if (!window.confirm("Refresh personas for all contacts? This may take a moment.")) {
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/ai/refresh-all-personas`, {
        method: "POST",
        credentials: "include",
      });

      if (res.ok) {
        // Update all contacts with new refresh time
        setContacts((prev) =>
          prev.map((c) => ({
            ...c,
            personaLastRefresh: new Date().toISOString(),
          }))
        );
        setSettingsSuccess("All personas refreshed");
        setTimeout(() => setSettingsSuccess(""), 3000);
      }
    } catch (err) {
      console.error("Failed to refresh personas:", err);
      setSettingsError("Failed to refresh personas");
    }
  };

  const getPersonaStatusColor = (lastRefresh?: string): string => {
    if (!lastRefresh) return "text-gray-500";
    const refreshTime = new Date(lastRefresh).getTime();
    const now = new Date().getTime();
    const hoursDiff = (now - refreshTime) / (1000 * 60 * 60);

    if (hoursDiff < 24) return "text-green-600";
    if (hoursDiff < 48) return "text-yellow-600";
    return "text-red-600";
  };

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="grid gap-6">
      {/* Settings Success/Error Messages */}
      {settingsSuccess && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          {settingsSuccess}
        </div>
      )}
      {settingsError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {settingsError}
        </div>
      )}

      {/* AI Master Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              AI Assistant Control
            </span>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(enabled) =>
                setSettings({ ...settings, enabled })
              }
            />
          </CardTitle>
          <CardDescription>
            {settings.enabled
              ? "✓ AI assistant is globally enabled"
              : "✗ AI assistant is globally disabled"}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>API Configuration</CardTitle>
          <CardDescription>Configure primary and fallback providers</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {/* Primary Provider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Primary Provider</label>
            <Select
              value={settings.primaryProvider}
              onValueChange={(value) =>
                setSettings({
                  ...settings,
                  primaryProvider: value as Provider,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Rate limit: {usage.groq.used}/{usage.groq.limit} calls
            </p>
          </div>

          {/* Fallback Provider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Fallback Provider</label>
            <Select
              value={settings.fallbackProvider}
              onValueChange={(value) =>
                setSettings({
                  ...settings,
                  fallbackProvider: value as Provider,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Rate limit: {usage.gemini.used}/{usage.gemini.limit} calls
            </p>
          </div>

          {/* Test API Connection */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Test API Connection</label>
            <div className="flex gap-2">
              <Button
                onClick={() => handleTestAPI("groq")}
                disabled={testLoading}
                variant="outline"
                size="sm"
              >
                {testLoading ? "Testing..." : "Test Groq"}
              </Button>
              <Button
                onClick={() => handleTestAPI("gemini")}
                disabled={testLoading}
                variant="outline"
                size="sm"
              >
                {testLoading ? "Testing..." : "Test Gemini"}
              </Button>
            </div>

            {testResult && (
              <div
                className={`mt-2 rounded-lg p-3 text-sm ${
                  testResult.success
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                <div className="flex items-start gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">{testResult.provider.toUpperCase()}</p>
                    <p className="text-xs opacity-75">{testResult.message}</p>
                    <p className="text-xs opacity-60 mt-1">{testResult.timestamp}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save Settings Button */}
          <div className="md:col-span-2">
            <Button
              onClick={handleSettingsSave}
              disabled={settingsSaving}
              className="w-full md:w-auto"
            >
              {settingsSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Usage Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>API Usage Statistics</CardTitle>
          <CardDescription>
            Last updated: {new Date(usage.lastUpdated).toLocaleTimeString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {/* Groq Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Groq API Usage</span>
              <span className="text-muted-foreground">
                {usage.groq.used}/{usage.groq.limit}
              </span>
            </div>
            <Progress
              value={(usage.groq.used / usage.groq.limit) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              {Math.round((usage.groq.used / usage.groq.limit) * 100)}% of limit used
            </p>
          </div>

          {/* Gemini Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Gemini API Usage</span>
              <span className="text-muted-foreground">
                {usage.gemini.used}/{usage.gemini.limit}
              </span>
            </div>
            <Progress
              value={(usage.gemini.used / usage.gemini.limit) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              {Math.round((usage.gemini.used / usage.gemini.limit) * 100)}% of limit used
            </p>
          </div>

          {/* Reset Time Info */}
          {usage.resetTime && (
            <div className="md:col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Resets: {new Date(usage.resetTime).toLocaleDateString()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Persona Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Persona Management</span>
            <Button
              onClick={handleRefreshAllPersonas}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Refresh All
            </Button>
          </CardTitle>
          <CardDescription>
            Manage AI personas for all active contacts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active contacts yet</p>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex-1">
                    <p className="font-medium">{contact.name}</p>
                    <p className="text-sm text-muted-foreground">{contact.phone}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`text-xs font-medium ${getPersonaStatusColor(
                          contact.personaLastRefresh
                        )}`}
                      >
                        Last refresh: {formatDate(contact.personaLastRefresh)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleViewPersona(contact.id)}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                    <Button
                      onClick={() => handleRefreshPersona(contact.id)}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-Contact Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Contact Settings</CardTitle>
          <CardDescription>Control AI features for individual contacts</CardDescription>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active contacts yet</p>
          ) : (
            <div className="space-y-4">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="rounded-lg border p-4 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-sm text-muted-foreground">{contact.phone}</p>
                    </div>
                    <Badge variant={contact.status === "error" ? "destructive" : "secondary"}>
                      {contact.messageCount} messages
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {contact.mimicMode ? (
                        <Eye className="h-4 w-4 text-blue-600" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-gray-400" />
                      )}
                      <div>
                        <p className="text-sm font-medium">Mimic Mode</p>
                        <p className="text-xs text-muted-foreground">
                          {contact.mimicMode
                            ? "AI is mimicking user style"
                            : "AI mimic mode is off"}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={contact.mimicMode}
                      onCheckedChange={(enabled) =>
                        handleToggleMimicMode(contact.id, enabled)
                      }
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleViewPersona(contact.id)}
                      variant="outline"
                      size="sm"
                      className="gap-1 flex-1"
                    >
                      <Eye className="h-4 w-4" />
                      View Persona
                    </Button>
                    <Button
                      onClick={() => handleViewHistory(contact.id)}
                      variant="outline"
                      size="sm"
                      className="gap-1 flex-1"
                    >
                      History
                    </Button>
                  </div>

                  {contact.lastMessageDate && (
                    <p className="text-xs text-muted-foreground">
                      Last message: {formatDate(contact.lastMessageDate)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Persona Modal */}
      {personaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl max-h-96 overflow-hidden flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle>Persona Data</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto flex-1">
              <pre className="text-xs overflow-auto rounded bg-muted p-4">
                {personaData}
              </pre>
            </CardContent>
            <div className="flex-shrink-0 border-t p-4 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setPersonaModalOpen(false);
                  setPersonaData("");
                }}
                variant="outline"
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* History Modal */}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl max-h-96 overflow-hidden flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle>Message History (Last 50)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto flex-1">
              <div className="space-y-3">
                {historyData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages found</p>
                ) : (
                  historyData.map((msg, idx) => (
                    <div key={idx} className="border-l-2 border-muted pl-3 py-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={msg.sender === "user" ? "default" : "secondary"}>
                          {msg.sender}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(msg.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{msg.content}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
            <div className="flex-shrink-0 border-t p-4 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setHistoryModalOpen(false);
                  setHistoryData([]);
                }}
                variant="outline"
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
