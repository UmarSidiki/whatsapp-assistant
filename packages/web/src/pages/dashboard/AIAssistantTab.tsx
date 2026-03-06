import { useState, useEffect } from "react";
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
  groqModel?: string;
  fallbackGroqModel?: string;
}

interface GroqApiKey {
  id: string;
  name?: string;
  keyValue: string;
  createdAt: string;
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

// Comprehensive list of Groq models
const GROQ_MODELS = [
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fastest)" },
  { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B (Versatile)" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Versatile)" },
  { id: "llama-guard-4-12b", name: "Llama Guard 4 12B" },
  { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick 17B" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B" },
  { id: "meta-llama/llama-prompt-guard-2-86m", name: "Llama Prompt Guard 2 86M" },
  { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B 32K (Default)" },
  { id: "groq/compound", name: "Groq Compound" },
  { id: "groq/compound-mini", name: "Groq Compound Mini" },
  { id: "moonshotai/kimi-k2-instruct", name: "Kimi K2 Instruct" },
  { id: "moonshotai/kimi-k2-instruct-0905", name: "Kimi K2 Instruct 0905" },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B" },
  { id: "openai/gpt-oss-20b", name: "GPT OSS 20B" },
  { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
  { id: "allam-2-7b", name: "Allam 2 7B" },
  { id: "canopylabs/orpheus-v1-english", name: "Orpheus V1 English" },
];

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

  // API test state
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<APITestResult | null>(null);

  // Modals state
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [personaData, setPersonaData] = useState<string>("");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyData, setHistoryData] = useState<Array<{ sender: string; timestamp: string; content: string }>>([]);

  // API Key management state
  const [groqApiKeys, setGroqApiKeys] = useState<GroqApiKey[]>([]);
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showAddApiKey, setShowAddApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);

  // Load initial data
  useEffect(() => {
    void loadSettings();
    void loadContacts();
    void loadUsageStats();
    void loadGroqApiKeys();

    // Auto-refresh stats every 30 seconds
    const interval = setInterval(() => {
      void loadUsageStats();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/settings`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        // Backend returns aiEnabled; map to state field enabled
        setSettings({
          enabled: data.aiEnabled ?? false,
          primaryProvider: data.primaryProvider ?? "groq",
          fallbackProvider: data.fallbackProvider ?? "gemini",
          groqModel: data.groqModel,
          fallbackGroqModel: data.fallbackGroqModel,
        });
        setSettingsError("");
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadContacts = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/contacts`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      }
    } catch (err) {
      console.error("Failed to load contacts:", err);
    }
  };

  const loadGroqApiKeys = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/api-keys/groq`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setGroqApiKeys(Array.isArray(data.keys) ? data.keys : []);
      }
    } catch (err) {
      console.error("Failed to load API keys:", err);
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
      const payload = {
        aiEnabled: settings.enabled,
        primaryProvider: settings.primaryProvider,
        fallbackProvider: settings.fallbackProvider,
        groqModel: settings.groqModel,
        fallbackGroqModel: settings.fallbackGroqModel,
      };

      console.log("Saving settings:", payload);

      const res = await fetch(`${apiUrl}/api/ai/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      console.log("Save response:", data);

      if (res.ok) {
        setSettingsSuccess("Settings saved successfully");
        setTimeout(() => setSettingsSuccess(""), 3000);
      } else {
        throw new Error(data.message || "Failed to save settings");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setSettingsError(`Error saving settings: ${errorMsg}`);
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

  const handleAddApiKey = async () => {
    if (!newApiKey.trim()) {
      setApiKeyError("API key cannot be empty");
      return;
    }

    setApiKeySaving(true);
    setApiKeyError("");

    try {
      const res = await fetch(`${apiUrl}/api/ai/api-keys/groq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          keyValue: newApiKey,
          name: newApiKeyName || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setGroqApiKeys([...groqApiKeys, data.key]);
        setNewApiKey("");
        setNewApiKeyName("");
        setShowAddApiKey(false);
      } else {
        const data = await res.json();
        setApiKeyError(data.message || "Failed to add API key");
      }
    } catch (err) {
      setApiKeyError("Error adding API key. Please try again.");
      console.error(err);
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleRemoveApiKey = async (keyId: string) => {
    if (!confirm("Are you sure you want to remove this API key?")) return;

    try {
      const res = await fetch(`${apiUrl}/api/ai/api-keys/groq/${keyId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setGroqApiKeys(groqApiKeys.filter((k) => k.id !== keyId));
      } else {
        setApiKeyError("Failed to remove API key");
      }
    } catch (err) {
      setApiKeyError("Error removing API key. Please try again.");
      console.error(err);
    }
  };

  const maskApiKey = (key: string): string => {
    if (key.length <= 8) return "*".repeat(key.length);
    return key.substring(0, 4) + "*".repeat(key.length - 8) + key.substring(key.length - 4);
  };

  const handleRefreshPersona = async (contactPhone: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/persona/${encodeURIComponent(contactPhone)}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) =>
            c.phone === contactPhone
              ? { ...c, personaLastRefresh: new Date().toISOString() }
              : c
          )
        );
      }
    } catch (err) {
      console.error("Failed to refresh persona:", err);
    }
  };

  const handleToggleMimicMode = async (contactPhone: string, enabled: boolean) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/mimic-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contactId: contactPhone, enabled }),
      });

      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.phone === contactPhone ? { ...c, mimicMode: enabled } : c))
        );
      }
    } catch (err) {
      console.error("Failed to toggle mimic mode:", err);
    }
  };

  const handleViewPersona = async (contactPhone: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/persona/${encodeURIComponent(contactPhone)}`, {
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

  const handleViewHistory = async (contactPhone: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/history/${encodeURIComponent(contactPhone)}`, {
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

          {/* Groq Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Primary Groq Model</label>
            <Select
              value={settings.groqModel || "llama-3.1-8b-instant"}
              onValueChange={(value) =>
                setSettings({
                  ...settings,
                  groqModel: value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROQ_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Primary model for Groq API calls
            </p>
          </div>

          {/* Fallback Groq Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Fallback Groq Model</label>
            <Select
              value={settings.fallbackGroqModel || "llama-3.1-70b-versatile"}
              onValueChange={(value) =>
                setSettings({
                  ...settings,
                  fallbackGroqModel: value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROQ_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Fallback model when primary is unavailable
            </p>
          </div>

          {/* Groq API Key Management */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Groq API Keys</label>
              <Button
                onClick={() => setShowAddApiKey(!showAddApiKey)}
                variant="outline"
                size="sm"
              >
                {showAddApiKey ? "Cancel" : "Add Key"}
              </Button>
            </div>

            {apiKeyError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {apiKeyError}
              </div>
            )}

            {showAddApiKey && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <input
                  type="text"
                  placeholder="API Key"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  className="w-full rounded border px-2 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Key name (optional)"
                  value={newApiKeyName}
                  onChange={(e) => setNewApiKeyName(e.target.value)}
                  className="w-full rounded border px-2 py-2 text-sm"
                />
                <Button
                  onClick={handleAddApiKey}
                  disabled={apiKeySaving || !newApiKey.trim()}
                  size="sm"
                  className="w-full"
                >
                  {apiKeySaving ? "Adding..." : "Add API Key"}
                </Button>
              </div>
            )}

            {groqApiKeys.length > 0 ? (
              <div className="space-y-2">
                {groqApiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{key.name || "Unnamed Key"}</p>
                      <p className="text-xs text-muted-foreground">
                        {maskApiKey(key.keyValue)}
                      </p>
                    </div>
                    <Button
                      onClick={() => handleRemoveApiKey(key.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No API keys added yet. Add one to use Groq API.
              </p>
            )}
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
                      onClick={() => handleViewPersona(contact.phone)}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                    <Button
                      onClick={() => handleRefreshPersona(contact.phone)}
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
                        handleToggleMimicMode(contact.phone, enabled)
                      }
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleViewPersona(contact.phone)}
                      variant="outline"
                      size="sm"
                      className="gap-1 flex-1"
                    >
                      <Eye className="h-4 w-4" />
                      View Persona
                    </Button>
                    <Button
                      onClick={() => handleViewHistory(contact.phone)}
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
