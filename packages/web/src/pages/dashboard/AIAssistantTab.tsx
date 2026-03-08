import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  RotateCcw,
  Eye,
  EyeOff,
  Zap,
  Plus,
  Trash2,
} from "lucide-react";

type Provider = "groq" | "gemini";
type ContactStatus = "ready" | "mimicking" | "error";

interface AISettings {
  enabled: boolean;
  primaryProvider: Provider;
  fallbackProvider: Provider;
  groqModel?: string;
  fallbackGroqModel?: string;
  geminiModel?: string;
  botName?: string;
  customInstructions?: string;
  timezone?: string;
}

interface ApiKey {
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

const CUSTOM_MODEL_VALUE = "__custom__";

// Common timezone options (offset in hours)
const TIMEZONES = [
  { id: "UTC", name: "UTC (±00:00)", offset: 0 },
  { id: "GMT+1", name: "GMT+1 (Central European)", offset: 1 },
  { id: "GMT+2", name: "GMT+2 (Eastern European)", offset: 2 },
  { id: "GMT+3", name: "GMT+3 (Moscow, East Africa)", offset: 3 },
  { id: "GMT+3.5", name: "GMT+3:30 (Iran)", offset: 3.5 },
  { id: "GMT+4", name: "GMT+4 (Dubai, Caucasus)", offset: 4 },
  { id: "GMT+4.5", name: "GMT+4:30 (Afghanistan)", offset: 4.5 },
  { id: "GMT+5", name: "GMT+5 (Pakistan)", offset: 5 },
  { id: "GMT+5.5", name: "GMT+5:30 (India, Sri Lanka)", offset: 5.5 },
  { id: "GMT+6", name: "GMT+6 (Bangladesh)", offset: 6 },
  { id: "GMT+7", name: "GMT+7 (Thailand, Vietnam)", offset: 7 },
  { id: "GMT+8", name: "GMT+8 (China, Singapore)", offset: 8 },
  { id: "GMT+9", name: "GMT+9 (Japan, Korea)", offset: 9 },
  { id: "GMT+10", name: "GMT+10 (Australia East)", offset: 10 },
  { id: "GMT-5", name: "GMT-5 (Eastern)", offset: -5 },
  { id: "GMT-6", name: "GMT-6 (Central)", offset: -6 },
  { id: "GMT-7", name: "GMT-7 (Mountain)", offset: -7 },
  { id: "GMT-8", name: "GMT-8 (Pacific)", offset: -8 },
  { id: "GMT-9", name: "GMT-9 (Alaska)", offset: -9 },
];

// Chat-capable Groq models (excludes guard/safety classifiers and speech models)
const GROQ_MODELS = [
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fastest)" },
  { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B (Versatile)" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Versatile)" },
  {
    id: "meta-llama/llama-4-maverick-17b-128e-instruct",
    name: "Llama 4 Maverick 17B",
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B",
  },
  { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B 32K" },
  { id: "groq/compound", name: "Groq Compound" },
  { id: "groq/compound-mini", name: "Groq Compound Mini" },
  { id: "moonshotai/kimi-k2-instruct", name: "Kimi K2 Instruct" },
  { id: "moonshotai/kimi-k2-instruct-0905", name: "Kimi K2 Instruct 0905" },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B" },
  { id: "openai/gpt-oss-20b", name: "GPT OSS 20B" },
  { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
];

// Gemini models
const GEMINI_MODELS = [
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (Default)" },
  { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash 8B" },
  { id: "gemini-2.5-flash-preview-05-20", name: "Gemini 2.5 Flash Preview" },
  { id: "gemini-2.5-pro-preview-06-05", name: "Gemini 2.5 Pro Preview" },
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
    botName: "",
    customInstructions: "",
    timezone: "UTC",
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
  const [personaData, setPersonaData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyData, setHistoryData] = useState<
    Array<{ sender: string; timestamp: string; message: string }>
  >([]);

  // Collapsible section state
  const [personaSectionOpen, setPersonaSectionOpen] = useState(true);
  const [perContactSectionOpen, setPerContactSectionOpen] = useState(true);

  // API Key management state - Groq
  const [groqApiKeys, setGroqApiKeys] = useState<ApiKey[]>([]);
  const [newGroqKey, setNewGroqKey] = useState("");
  const [newGroqKeyName, setNewGroqKeyName] = useState("");
  const [showAddGroqKey, setShowAddGroqKey] = useState(false);
  const [groqKeyError, setGroqKeyError] = useState("");
  const [groqKeySaving, setGroqKeySaving] = useState(false);

  // API Key management state - Gemini
  const [geminiApiKeys, setGeminiApiKeys] = useState<ApiKey[]>([]);
  const [newGeminiKey, setNewGeminiKey] = useState("");
  const [newGeminiKeyName, setNewGeminiKeyName] = useState("");
  const [showAddGeminiKey, setShowAddGeminiKey] = useState(false);
  const [geminiKeyError, setGeminiKeyError] = useState("");
  const [geminiKeySaving, setGeminiKeySaving] = useState(false);

  // Custom model inputs
  const [customGroqModel, setCustomGroqModel] = useState("");
  const [customFallbackGroqModel, setCustomFallbackGroqModel] = useState("");
  const [customGeminiModel, setCustomGeminiModel] = useState("");
  const [useCustomGroqModel, setUseCustomGroqModel] = useState(false);
  const [useCustomFallbackGroqModel, setUseCustomFallbackGroqModel] =
    useState(false);
  const [useCustomGeminiModel, setUseCustomGeminiModel] = useState(false);

  // Load initial data
  useEffect(() => {
    void loadSettings();
    void loadContacts();
    void loadUsageStats();
    void loadGroqApiKeys();
    void loadGeminiApiKeys();

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
        const groqModel = data.groqModel || "llama-3.1-8b-instant";
        const fallbackGroqModel =
          data.fallbackGroqModel || "llama-3.1-70b-versatile";
        const geminiModel = data.geminiModel || "gemini-2.0-flash";

        // Detect custom models (not in predefined lists)
        const isCustomGroq = !GROQ_MODELS.some((m) => m.id === groqModel);
        const isCustomFallbackGroq = !GROQ_MODELS.some(
          (m) => m.id === fallbackGroqModel,
        );
        const isCustomGemini = !GEMINI_MODELS.some((m) => m.id === geminiModel);

        if (isCustomGroq) {
          setUseCustomGroqModel(true);
          setCustomGroqModel(groqModel);
        }
        if (isCustomFallbackGroq) {
          setUseCustomFallbackGroqModel(true);
          setCustomFallbackGroqModel(fallbackGroqModel);
        }
        if (isCustomGemini) {
          setUseCustomGeminiModel(true);
          setCustomGeminiModel(geminiModel);
        }

        setSettings({
          enabled: data.aiEnabled ?? false,
          primaryProvider: data.primaryProvider ?? "groq",
          fallbackProvider: data.fallbackProvider ?? "gemini",
          groqModel,
          fallbackGroqModel,
          geminiModel,
          botName: data.botName ?? "",
          customInstructions: data.customInstructions ?? "",
          timezone: data.timezone ?? "UTC",
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
      console.error("Failed to load Groq API keys:", err);
    }
  };

  const loadGeminiApiKeys = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/api-keys/gemini`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setGeminiApiKeys(Array.isArray(data.keys) ? data.keys : []);
      }
    } catch (err) {
      console.error("Failed to load Gemini API keys:", err);
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
        groqModel: useCustomGroqModel ? customGroqModel : settings.groqModel,
        fallbackGroqModel: useCustomFallbackGroqModel
          ? customFallbackGroqModel
          : settings.fallbackGroqModel,
        geminiModel: useCustomGeminiModel
          ? customGeminiModel
          : settings.geminiModel,
        botName: settings.botName || null,
        customInstructions: settings.customInstructions || null,
        timezone: settings.timezone || "UTC",
      };

      const res = await fetch(`${apiUrl}/api/ai/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

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
        message:
          data.message ||
          (res.ok ? "Connection successful" : "Connection failed"),
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

  const handleAddApiKey = async (provider: Provider) => {
    const key = provider === "groq" ? newGroqKey : newGeminiKey;
    const name = provider === "groq" ? newGroqKeyName : newGeminiKeyName;
    const setError = provider === "groq" ? setGroqKeyError : setGeminiKeyError;
    const setSaving =
      provider === "groq" ? setGroqKeySaving : setGeminiKeySaving;

    if (!key.trim()) {
      setError("API key cannot be empty");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch(`${apiUrl}/api/ai/api-keys/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyValue: key, name: name || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        if (provider === "groq") {
          setGroqApiKeys([...groqApiKeys, data.key]);
          setNewGroqKey("");
          setNewGroqKeyName("");
          setShowAddGroqKey(false);
        } else {
          setGeminiApiKeys([...geminiApiKeys, data.key]);
          setNewGeminiKey("");
          setNewGeminiKeyName("");
          setShowAddGeminiKey(false);
        }
      } else {
        const data = await res.json();
        setError(data.message || "Failed to add API key");
      }
    } catch (err) {
      setError("Error adding API key. Please try again.");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveApiKey = async (provider: Provider, keyId: string) => {
    if (!confirm("Are you sure you want to remove this API key?")) return;

    const setError = provider === "groq" ? setGroqKeyError : setGeminiKeyError;

    try {
      const res = await fetch(
        `${apiUrl}/api/ai/api-keys/${provider}/${keyId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (res.ok) {
        if (provider === "groq") {
          setGroqApiKeys(groqApiKeys.filter((k) => k.id !== keyId));
        } else {
          setGeminiApiKeys(geminiApiKeys.filter((k) => k.id !== keyId));
        }
      } else {
        setError("Failed to remove API key");
      }
    } catch (err) {
      setError("Error removing API key. Please try again.");
      console.error(err);
    }
  };

  const maskApiKey = (key: string): string => {
    if (key.length <= 8) return "*".repeat(key.length);
    return (
      key.substring(0, 4) +
      "*".repeat(key.length - 8) +
      key.substring(key.length - 4)
    );
  };

  const handleRefreshPersona = async (contactPhone: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/ai/persona/${encodeURIComponent(contactPhone)}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        },
      );

      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) =>
            c.phone === contactPhone
              ? { ...c, personaLastRefresh: new Date().toISOString() }
              : c,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to refresh persona:", err);
    }
  };

  const handleToggleMimicMode = async (
    contactPhone: string,
    enabled: boolean,
  ) => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/mimic-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contactId: contactPhone, enabled }),
      });

      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) =>
            c.phone === contactPhone ? { ...c, mimicMode: enabled } : c,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to toggle mimic mode:", err);
    }
  };

  const handleViewPersona = async (contactPhone: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/ai/persona/${encodeURIComponent(contactPhone)}`,
        {
          credentials: "include",
        },
      );
      if (res.ok) {
        const data = await res.json();
        setPersonaData(data.persona ?? data);
        setPersonaModalOpen(true);
      }
    } catch (err) {
      console.error("Failed to load persona:", err);
    }
  };

  const handleViewHistory = async (contactPhone: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/ai/history/${encodeURIComponent(contactPhone)}`,
        {
          credentials: "include",
        },
      );
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
    if (
      !window.confirm(
        "Refresh personas for all contacts? This may take a moment.",
      )
    ) {
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
          })),
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
          <CardDescription>
            Configure primary and fallback providers
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {/* Primary Provider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Primary Provider</label>
            <Select
              value={settings.primaryProvider}
              onValueChange={(value) =>
                setSettings({ ...settings, primaryProvider: value as Provider })
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
            {useCustomGroqModel ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter custom model ID"
                  value={customGroqModel}
                  onChange={(e) => {
                    setCustomGroqModel(e.target.value);
                    setSettings({ ...settings, groqModel: e.target.value });
                  }}
                  className="flex-1 rounded border px-2 py-2 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUseCustomGroqModel(false);
                    setSettings({
                      ...settings,
                      groqModel: "llama-3.1-8b-instant",
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Select
                value={settings.groqModel || "llama-3.1-8b-instant"}
                onValueChange={(value) => {
                  if (value === CUSTOM_MODEL_VALUE) {
                    setUseCustomGroqModel(true);
                    setCustomGroqModel("");
                  } else {
                    setSettings({ ...settings, groqModel: value });
                  }
                }}
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
                  <SelectItem value={CUSTOM_MODEL_VALUE}>
                    ✏️ Custom Model...
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Primary model for Groq API calls
            </p>
          </div>

          {/* Fallback Groq Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Fallback Groq Model</label>
            {useCustomFallbackGroqModel ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter custom model ID"
                  value={customFallbackGroqModel}
                  onChange={(e) => {
                    setCustomFallbackGroqModel(e.target.value);
                    setSettings({
                      ...settings,
                      fallbackGroqModel: e.target.value,
                    });
                  }}
                  className="flex-1 rounded border px-2 py-2 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUseCustomFallbackGroqModel(false);
                    setSettings({
                      ...settings,
                      fallbackGroqModel: "llama-3.1-70b-versatile",
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Select
                value={settings.fallbackGroqModel || "llama-3.1-70b-versatile"}
                onValueChange={(value) => {
                  if (value === CUSTOM_MODEL_VALUE) {
                    setUseCustomFallbackGroqModel(true);
                    setCustomFallbackGroqModel("");
                  } else {
                    setSettings({ ...settings, fallbackGroqModel: value });
                  }
                }}
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
                  <SelectItem value={CUSTOM_MODEL_VALUE}>
                    ✏️ Custom Model...
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Fallback model when primary is unavailable
            </p>
          </div>

          {/* Gemini Model Selection */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Gemini Model</label>
            {useCustomGeminiModel ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter custom Gemini model ID"
                  value={customGeminiModel}
                  onChange={(e) => {
                    setCustomGeminiModel(e.target.value);
                    setSettings({ ...settings, geminiModel: e.target.value });
                  }}
                  className="flex-1 rounded border px-2 py-2 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUseCustomGeminiModel(false);
                    setSettings({
                      ...settings,
                      geminiModel: "gemini-2.0-flash",
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Select
                value={settings.geminiModel || "gemini-2.0-flash"}
                onValueChange={(value) => {
                  if (value === CUSTOM_MODEL_VALUE) {
                    setUseCustomGeminiModel(true);
                    setCustomGeminiModel("");
                  } else {
                    setSettings({ ...settings, geminiModel: value });
                  }
                }}
              >
                <SelectTrigger className="md:w-1/2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_MODEL_VALUE}>
                    ✏️ Custom Model...
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Model for Gemini API calls
            </p>
          </div>

          {/* Groq API Key Management */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Groq API Keys</label>
              <Button
                onClick={() => setShowAddGroqKey(!showAddGroqKey)}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <Plus className="h-3 w-3" />
                {showAddGroqKey ? "Cancel" : "Add Key"}
              </Button>
            </div>

            {groqKeyError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {groqKeyError}
              </div>
            )}

            {showAddGroqKey && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <input
                  type="text"
                  placeholder="gsk_..."
                  value={newGroqKey}
                  onChange={(e) => setNewGroqKey(e.target.value)}
                  className="w-full rounded border px-2 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Key name (optional)"
                  value={newGroqKeyName}
                  onChange={(e) => setNewGroqKeyName(e.target.value)}
                  className="w-full rounded border px-2 py-2 text-sm"
                />
                <Button
                  onClick={() => handleAddApiKey("groq")}
                  disabled={groqKeySaving || !newGroqKey.trim()}
                  size="sm"
                  className="w-full"
                >
                  {groqKeySaving ? "Adding..." : "Add Groq API Key"}
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
                      onClick={() => handleRemoveApiKey("groq", key.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 gap-1"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No Groq API keys added yet. Add one to use Groq API.
              </p>
            )}
          </div>

          {/* Gemini API Key Management */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Gemini API Keys</label>
              <Button
                onClick={() => setShowAddGeminiKey(!showAddGeminiKey)}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <Plus className="h-3 w-3" />
                {showAddGeminiKey ? "Cancel" : "Add Key"}
              </Button>
            </div>

            {geminiKeyError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {geminiKeyError}
              </div>
            )}

            {showAddGeminiKey && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <input
                  type="text"
                  placeholder="AIza..."
                  value={newGeminiKey}
                  onChange={(e) => setNewGeminiKey(e.target.value)}
                  className="w-full rounded border px-2 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Key name (optional)"
                  value={newGeminiKeyName}
                  onChange={(e) => setNewGeminiKeyName(e.target.value)}
                  className="w-full rounded border px-2 py-2 text-sm"
                />
                <Button
                  onClick={() => handleAddApiKey("gemini")}
                  disabled={geminiKeySaving || !newGeminiKey.trim()}
                  size="sm"
                  className="w-full"
                >
                  {geminiKeySaving ? "Adding..." : "Add Gemini API Key"}
                </Button>
              </div>
            )}

            {geminiApiKeys.length > 0 ? (
              <div className="space-y-2">
                {geminiApiKeys.map((key) => (
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
                      onClick={() => handleRemoveApiKey("gemini", key.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 gap-1"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No Gemini API keys added yet. Add one to use Google Gemini.
              </p>
            )}
          </div>

          {/* Bot Command Name */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Bot Command Name</label>
            <input
              type="text"
              placeholder="e.g. alex (type !alex <question> to get AI help)"
              value={settings.botName ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, botName: e.target.value })
              }
              className="w-full rounded border px-2 py-2 text-sm md:w-1/2"
            />
            <p className="text-xs text-muted-foreground">
              Sets a public command name, e.g.{" "}
              <code className="bg-muted px-1 rounded">!alex</code>. Your contacts can use this to interact with the AI.{" "}
              <code className="bg-muted px-1 rounded">!me</code> is always available for your own private usage.
            </p>
          </div>

          {/* Custom Instructions */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">
              Timezone
            </label>
            <Select value={settings.timezone || "UTC"} onValueChange={(value) =>
              setSettings({ ...settings, timezone: value })
            }>
              <SelectTrigger>
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.id} value={tz.id}>
                    {tz.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used for scheduling messages and displaying reminders in your local time.
            </p>
          </div>

          {/* Custom Instructions */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">
              Custom Instructions for AI
            </label>
            <textarea
              placeholder="e.g. Reply in Roman Urdu. Keep responses very short. Use lots of emojis."
              value={settings.customInstructions ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, customInstructions: e.target.value })
              }
              rows={3}
              className="w-full rounded border px-2 py-2 text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Additional behavior instructions appended to every AI prompt.
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
                    <p className="font-medium">
                      {testResult.provider.toUpperCase()}
                    </p>
                    <p className="text-xs opacity-75">{testResult.message}</p>
                    <p className="text-xs opacity-60 mt-1">
                      {testResult.timestamp}
                    </p>
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
            Rolling per-minute usage (rate limit window) · Last updated:{" "}
            {new Date(usage.lastUpdated).toLocaleTimeString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {/* Groq Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Groq — Calls / min</span>
              <span className="text-muted-foreground">
                {usage.groq.used}/{usage.groq.limit}
              </span>
            </div>
            <Progress
              value={(usage.groq.used / usage.groq.limit) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              {Math.round((usage.groq.used / usage.groq.limit) * 100)}% of{" "}
              {usage.groq.limit} RPM limit used (last 60s)
            </p>
          </div>

          {/* Gemini Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Gemini — Calls / min</span>
              <span className="text-muted-foreground">
                {usage.gemini.used}/{usage.gemini.limit}
              </span>
            </div>
            <Progress
              value={(usage.gemini.used / usage.gemini.limit) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              {Math.round((usage.gemini.used / usage.gemini.limit) * 100)}% of{" "}
              {usage.gemini.limit} RPM limit used (last 60s)
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
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setPersonaSectionOpen((o) => !o)}
        >
          <CardTitle className="flex items-center justify-between">
            <span>Persona Management</span>
            <div className="flex items-center gap-2">
              {personaSectionOpen && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRefreshAllPersonas();
                  }}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Refresh All
                </Button>
              )}
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${personaSectionOpen ? "rotate-180" : ""}`}
              />
            </div>
          </CardTitle>
          <CardDescription>
            Manage AI personas for all active contacts
          </CardDescription>
        </CardHeader>
        {personaSectionOpen && (
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active contacts yet
              </p>
            ) : (
              <div className="space-y-3">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {contact.phone}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`text-xs font-medium ${getPersonaStatusColor(
                            contact.personaLastRefresh,
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
        )}
      </Card>

      {/* Per-Contact Controls */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setPerContactSectionOpen((o) => !o)}
        >
          <CardTitle className="flex items-center justify-between">
            <span>Per-Contact Settings</span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${perContactSectionOpen ? "rotate-180" : ""}`}
            />
          </CardTitle>
          <CardDescription>
            Control AI features for individual contacts
          </CardDescription>
        </CardHeader>
        {perContactSectionOpen && (
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active contacts yet
              </p>
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
                        <p className="text-sm text-muted-foreground">
                          {contact.phone}
                        </p>
                      </div>
                      <Badge
                        variant={
                          contact.status === "error" ? "destructive" : "secondary"
                        }
                      >
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
        )}
      </Card>

      {/* Commands Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Commands Reference</CardTitle>
          <CardDescription>
            Type these commands in any WhatsApp chat (as yourself) to control AI
            behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Command</th>
                  <th className="text-left px-4 py-2 font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !me &lt;question&gt;
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Private command (for your use only). Ask AI to answer/explain a message.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !me -r - {"{task}"} -{"{time}"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Schedule a reminder with relative or AM/PM time. Examples:{" "}
                    <code className="bg-muted px-1 rounded">!me -r - pay bill -30 minutes</code>{" "}
                    or{" "}
                    <code className="bg-muted px-1 rounded">!me -r - join standup -4:00 AM</code>.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !me -d -here
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Reply to a once-view media message, then run this command to copy that media into the same chat.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !me -d -n {"{number}"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Reply to a once-view media message, then run this command to forward the same media to another number.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !me -s {"{count}"} -d {"{seconds}"} - {"{message}"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Repeat a message multiple times with a delay. Example:{" "}
                    <code className="bg-muted px-1 rounded">!me -s 10 -d 5 - payment reminder</code>. You can also reply to a text and use{" "}
                    <code className="bg-muted px-1 rounded">!me -s 10 -d 5</code>.
                  </td>
                </tr>
                {settings.botName && (
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                      !{settings.botName} &lt;question&gt;
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      Public command (for your contacts). Allows them to interact with the AI directly.
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !mimic on
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Enable AI auto-reply for this contact (default: on).
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !mimic off
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Disable AI auto-reply for this contact only.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !mimic global on
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Enable AI globally (responds to ALL contacts).
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !mimic global off
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Disable AI globally (stops responding to everyone).
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !refresh persona
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Force-rebuild the AI persona for this contact from your
                    message history.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs bg-muted/30">
                    !ai status
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Show current AI settings (enabled/disabled, provider,
                    commands list).
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground space-y-2">
            <p>
              <strong>Reminder setup:</strong> send <code className="bg-muted px-1 rounded">!me -r - {"{task}"} -{"{time}"}</code> (or <code className="bg-muted px-1 rounded">!{settings.botName || "yourBotName"} -r - {"{task}"} -{"{time}"}</code> if you configured a bot name). Time can be relative (<code className="bg-muted px-1 rounded">-30 minutes</code>) or AM/PM (<code className="bg-muted px-1 rounded">-4:00 AM</code>).
            </p>
            <p>
              <strong>Once-view media download:</strong> first reply to the once-view photo/video, then send <code className="bg-muted px-1 rounded">!me -d -here</code> to keep it in the current chat or <code className="bg-muted px-1 rounded">!me -d -n {"{number}"}</code> to send it to another number.
            </p>
            <p>
              <strong>Repeat message setup:</strong> send <code className="bg-muted px-1 rounded">!me -s {"{count}"} -d {"{seconds}"} {"{message}"}</code> (or <code className="bg-muted px-1 rounded">!{settings.botName || "yourBotName"} -s {"{count}"} -d {"{seconds}"} {"{message}"}</code>) to repeat a text with delay. You can also reply to a text and run <code className="bg-muted px-1 rounded">!me -s {"{count}"} -d {"{seconds}"}</code>.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Control commands (like <strong>!mimic</strong>, <strong>!refresh</strong>) must be sent as <strong>your own messages</strong> in the chat.
          </p>
        </CardContent>
      </Card>

      {/* Persona Modal */}
      {personaModalOpen && personaData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle>Persona Analysis</CardTitle>
              <p className="text-sm text-muted-foreground">
                How the AI understands your communication style with this
                contact
              </p>
            </CardHeader>
            <CardContent className="overflow-auto flex-1 space-y-4">
              {/* AI-generated description — most important, show first */}
              {!!personaData.aiDescription && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                    AI-Generated Voice Profile
                  </p>
                  <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
                    {String(personaData.aiDescription)}
                  </p>
                </div>
              )}

              {/* Rule-based breakdown */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {!!personaData.tone && (
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-1">
                      Tone
                    </p>
                    <p className="capitalize font-medium">
                      {String(personaData.tone)}
                    </p>
                  </div>
                )}
                {!!personaData.emotionalTone && (
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-1">
                      Emotional Tone
                    </p>
                    <p className="capitalize font-medium">
                      {String(personaData.emotionalTone)}
                    </p>
                  </div>
                )}
                {!!personaData.greetingStyle && (
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-1">
                      Greeting Style
                    </p>
                    <p className="capitalize font-medium">
                      {String(personaData.greetingStyle)}
                    </p>
                  </div>
                )}
                {!!personaData.emojiUsage && (
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-1">
                      Emoji Usage
                    </p>
                    <p className="capitalize font-medium">
                      {String(
                        (personaData.emojiUsage as Record<string, unknown>)
                          ?.frequency ?? "",
                      )}
                      {Array.isArray(
                        (personaData.emojiUsage as Record<string, unknown>)
                          ?.topEmojis,
                      ) &&
                        (
                          (personaData.emojiUsage as Record<string, unknown>)
                            .topEmojis as string[]
                        ).length > 0 && (
                          <span className="ml-2">
                            {(
                              (
                                personaData.emojiUsage as Record<
                                  string,
                                  unknown
                                >
                              ).topEmojis as string[]
                            ).join(" ")}
                          </span>
                        )}
                    </p>
                  </div>
                )}
                {!!personaData.messageFormat && (
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-1">
                      Message Length
                    </p>
                    <p className="font-medium capitalize">
                      {String(
                        (personaData.messageFormat as Record<string, unknown>)
                          ?.preferredStructure ?? "",
                      )}{" "}
                      (avg{" "}
                      {String(
                        (personaData.messageFormat as Record<string, unknown>)
                          ?.avgLength ?? 0,
                      )}{" "}
                      chars)
                    </p>
                  </div>
                )}
              </div>

              {/* Common phrases */}
              {Array.isArray(personaData.commonPhrases) &&
                personaData.commonPhrases.length > 0 && (
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-2">
                      Common Phrases
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(personaData.commonPhrases as string[]).map(
                        (phrase, i) => (
                          <span
                            key={i}
                            className="rounded bg-muted px-2 py-1 text-xs"
                          >
                            "{phrase}"
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}

              {/* Response patterns */}
              {!!personaData.responsePatterns && (
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground font-medium mb-1">
                    Response Patterns
                  </p>
                  <p className="text-sm">
                    {String(personaData.responsePatterns)}
                  </p>
                </div>
              )}
            </CardContent>
            <div className="flex-shrink-0 border-t p-4 flex justify-end">
              <Button
                onClick={() => {
                  setPersonaModalOpen(false);
                  setPersonaData(null);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle>Message History (Last 50)</CardTitle>
              <p className="text-sm text-muted-foreground">
                You = your messages &nbsp;|&nbsp; Contact = their messages
              </p>
            </CardHeader>
            <CardContent className="overflow-auto flex-1">
              <div className="space-y-3">
                {historyData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No messages found
                  </p>
                ) : (
                  historyData.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          msg.sender === "me"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="break-words">{msg.message}</p>
                        <p
                          className={`mt-1 text-xs ${msg.sender === "me" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                        >
                          {new Date(msg.timestamp).toLocaleString()}
                        </p>
                      </div>
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
