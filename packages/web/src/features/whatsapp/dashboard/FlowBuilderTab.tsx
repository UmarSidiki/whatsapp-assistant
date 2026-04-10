import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, ArrowLeft, Pencil, Trash2, Copy, Workflow } from "lucide-react";
import { FlowCanvas } from "./flow-builder/FlowCanvas";
import type { ChatbotFlow, FlowDefinition } from "./flow-builder/types";

type View = "list" | "editor";

export function FlowBuilderTab({ apiUrl }: { apiUrl: string }) {
  const [view, setView] = useState<View>("list");
  const [flows, setFlows] = useState<ChatbotFlow[]>([]);
  const [error, setError] = useState("");

  // Editor state
  const [editingFlow, setEditingFlow] = useState<ChatbotFlow | null>(null);
  const [flowName, setFlowName] = useState("");
  const [flowDescription, setFlowDescription] = useState("");
  const [flowData, setFlowData] = useState<FlowDefinition>({ nodes: [], edges: [] });
  const [saving, setSaving] = useState(false);

  const loadFlows = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp/flows`, { credentials: "include" });
      if (res.ok) setFlows(await res.json());
    } catch {
      // silent
    }
  };

  useEffect(() => {
    loadFlows();
  }, [apiUrl]);

  const handleNew = () => {
    setEditingFlow(null);
    setFlowName("");
    setFlowDescription("");
    setFlowData({ nodes: [], edges: [] });
    setView("editor");
    setError("");
  };

  const handleEdit = (flow: ChatbotFlow) => {
    setEditingFlow(flow);
    setFlowName(flow.name);
    setFlowDescription(flow.description ?? "");
    setFlowData(flow.flowData);
    setView("editor");
    setError("");
  };

  const handleDuplicate = async (flow: ChatbotFlow) => {
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: `${flow.name} (copy)`,
          description: flow.description,
          flowData: flow.flowData,
          priority: flow.priority,
        }),
      });
      if (res.ok) await loadFlows();
    } catch {
      // silent
    }
  };

  const handleSave = async () => {
    setError("");
    if (!flowName.trim()) return setError("Flow name is required.");

    const hasTrigger = flowData.nodes.some((n) => n.type === "trigger");
    if (!hasTrigger) return setError("Flow must have at least one Trigger node.");

    setSaving(true);
    try {
      const body = {
        name: flowName,
        description: flowDescription || undefined,
        flowData,
      };

      const url = editingFlow
        ? `${apiUrl}/api/whatsapp/flows/${editingFlow.id}`
        : `${apiUrl}/api/whatsapp/flows`;

      const res = await fetch(url, {
        method: editingFlow ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Failed to save flow.");
        setSaving(false);
        return;
      }

      await loadFlows();
      setView("list");
    } catch {
      setError("Failed to save flow.");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`${apiUrl}/api/whatsapp/flows/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    loadFlows();
  };

  const handleToggle = async (flow: ChatbotFlow) => {
    await fetch(`${apiUrl}/api/whatsapp/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: !flow.enabled }),
    });
    loadFlows();
  };

  const onFlowDataChange = useCallback((data: FlowDefinition) => {
    setFlowData(data);
  }, []);

  if (view === "editor") {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Editor Header */}
        <div className="flex items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setView("list")}>
              <ArrowLeft className="size-4 mr-1" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-48 text-sm font-medium"
                placeholder="Flow name"
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
              />
              <Input
                className="h-8 w-56 text-sm text-muted-foreground"
                placeholder="Description (optional)"
                value={flowDescription}
                onChange={(e) => setFlowDescription(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-sm text-destructive">{error}</span>}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="size-4 mr-1.5" />
              {saving ? "Saving…" : "Save Flow"}
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <FlowCanvas apiUrl={apiUrl} initialData={flowData} onChange={onFlowDataChange} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Chatbot Flows</CardTitle>
              <CardDescription>
                Build professional WhatsApp automations with visual triggers, conditions, messages,
                image delivery, and CTA actions. Flows are checked before auto-reply rules, and
                the first matching flow executes.
              </CardDescription>
            </div>
            <Button onClick={handleNew}>
              <Plus className="size-4 mr-1.5" />
              New Flow
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {flows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Workflow className="size-12 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No flows yet.</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first chatbot flow with the visual builder.
              </p>
              <Button variant="outline" onClick={handleNew}>
                <Plus className="size-4 mr-1.5" />
                Create Flow
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {flows.map((flow) => {
                const triggerCount = flow.flowData.nodes.filter((n) => n.type === "trigger").length;
                const nodeCount = flow.flowData.nodes.length;
                return (
                  <div key={flow.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{flow.name}</span>
                        {!flow.enabled && <Badge variant="secondary">Disabled</Badge>}
                        <Badge variant="outline" className="text-xs">
                          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {triggerCount} trigger{triggerCount !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      {flow.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">{flow.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        checked={flow.enabled}
                        onCheckedChange={() => handleToggle(flow)}
                        title={flow.enabled ? "Disable" : "Enable"}
                      />
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => handleEdit(flow)} title="Edit">
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => handleDuplicate(flow)} title="Duplicate">
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(flow.id)}
                        title="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
