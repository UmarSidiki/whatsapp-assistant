import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Trash2 } from "lucide-react";
import type { FlowNodeData, FlowButton } from "./types";
import { NODE_COLORS } from "./types";

interface NodePropertiesProps {
  nodeId: string;
  nodeType: string;
  data: FlowNodeData;
  onChange: (nodeId: string, data: FlowNodeData) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
}

export function NodeProperties({ nodeId, nodeType, data, onChange, onClose, onDelete }: NodePropertiesProps) {
  const [local, setLocal] = useState<FlowNodeData>({ ...data });
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  const [prevData, setPrevData] = useState(data);
  const colors = NODE_COLORS[nodeType as keyof typeof NODE_COLORS] ?? NODE_COLORS.message;

  // This replaces the useEffect. 
  // Updating state during render tells React to throw away the current 
  // incomplete render and immediately re-render with the new state, 
  // avoiding the visual "flicker" of a double render.
  if (nodeId !== prevNodeId || data !== prevData) {
    setPrevNodeId(nodeId);
    setPrevData(data);
    setLocal({ ...data });
  }

  const update = (patch: Partial<FlowNodeData>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(nodeId, next);
  };

  return (
    <div className="w-72 border-l bg-card flex flex-col overflow-hidden">
      <div className={`flex items-center justify-between px-3 py-2 border-b ${colors.bg}`}>
        <span className={`text-sm font-semibold ${colors.text} capitalize`}>{nodeType} Properties</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {nodeType === "trigger" && <TriggerFields data={local} update={update} />}
        {nodeType === "condition" && <ConditionFields data={local} update={update} />}
        {nodeType === "message" && <MessageFields data={local} update={update} />}
        {nodeType === "buttons" && <ButtonsFields data={local} update={update} />}
        {nodeType === "delay" && <DelayFields data={local} update={update} />}
      </div>
      <div className="border-t p-3">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => onDelete(nodeId)}
        >
          <Trash2 className="size-3.5 mr-1.5" />
          Delete Node
        </Button>
      </div>
    </div>
  );
}

function TriggerFields({ data, update }: { data: FlowNodeData; update: (p: Partial<FlowNodeData>) => void }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Keyword</Label>
        <Input
          placeholder="e.g. hello, help, pricing"
          value={data.keyword ?? ""}
          onChange={(e) => update({ keyword: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Match Type</Label>
        <Select value={data.matchType ?? "contains"} onValueChange={(v) => update({ matchType: v as FlowNodeData["matchType"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exact">Exact match</SelectItem>
            <SelectItem value="contains">Contains</SelectItem>
            <SelectItem value="startsWith">Starts with</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function ConditionFields({ data, update }: { data: FlowNodeData; update: (p: Partial<FlowNodeData>) => void }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Check field</Label>
        <Select value={data.conditionField ?? "message"} onValueChange={(v) => update({ conditionField: v as FlowNodeData["conditionField"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="message">Message text</SelectItem>
            <SelectItem value="sender">Sender phone</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Operator</Label>
        <Select value={data.conditionOperator ?? "contains"} onValueChange={(v) => update({ conditionOperator: v as FlowNodeData["conditionOperator"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="equals">Equals</SelectItem>
            <SelectItem value="contains">Contains</SelectItem>
            <SelectItem value="startsWith">Starts with</SelectItem>
            <SelectItem value="notContains">Does not contain</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Value</Label>
        <Input
          placeholder="e.g. pricing, support"
          value={data.conditionValue ?? ""}
          onChange={(e) => update({ conditionValue: e.target.value })}
        />
      </div>
    </>
  );
}

function MessageFields({ data, update }: { data: FlowNodeData; update: (p: Partial<FlowNodeData>) => void }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Message</Label>
        <Textarea
          placeholder="Type your auto-reply message…"
          rows={5}
          value={data.messageText ?? ""}
          onChange={(e) => update({ messageText: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground">
          Variables: <code>{"{message}"}</code>, <code>{"{sender}"}</code>, <code>{"{phone}"}</code>
        </p>
      </div>
    </>
  );
}

function ButtonsFields({ data, update }: { data: FlowNodeData; update: (p: Partial<FlowNodeData>) => void }) {
  const buttons = data.buttons ?? [];

  const addButton = () => {
    const newBtn: FlowButton = { id: crypto.randomUUID(), type: "reply", text: "" };
    update({ buttons: [...buttons, newBtn] });
  };

  const updateButton = (idx: number, patch: Partial<FlowButton>) => {
    const updated = buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    update({ buttons: updated });
  };

  const removeButton = (idx: number) => {
    update({ buttons: buttons.filter((_, i) => i !== idx) });
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Message text</Label>
        <Textarea
          placeholder="Message shown above buttons…"
          rows={3}
          value={data.buttonText ?? ""}
          onChange={(e) => update({ buttonText: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Footer (optional)</Label>
        <Input
          placeholder="Footer text"
          value={data.buttonFooter ?? ""}
          onChange={(e) => update({ buttonFooter: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Buttons</Label>
          <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={addButton}>
            <Plus className="size-3 mr-1" /> Add
          </Button>
        </div>
        {buttons.map((btn, idx) => (
          <div key={btn.id} className="rounded border bg-background p-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <Select value={btn.type} onValueChange={(v) => updateButton(idx, { type: v as FlowButton["type"] })}>
                <SelectTrigger className="h-7 text-xs w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reply">Reply</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-7 text-xs flex-1"
                placeholder="Button text"
                value={btn.text}
                onChange={(e) => updateButton(idx, { text: e.target.value })}
              />
              <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => removeButton(idx)}>
                <Trash2 className="size-3 text-destructive" />
              </Button>
            </div>
            {btn.type === "url" && (
              <Input
                className="h-7 text-xs"
                placeholder="https://example.com"
                value={btn.url ?? ""}
                onChange={(e) => updateButton(idx, { url: e.target.value })}
              />
            )}
            {btn.type === "call" && (
              <Input
                className="h-7 text-xs"
                placeholder="+1234567890"
                value={btn.phoneNumber ?? ""}
                onChange={(e) => updateButton(idx, { phoneNumber: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function DelayFields({ data, update }: { data: FlowNodeData; update: (p: Partial<FlowNodeData>) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Delay (seconds)</Label>
      <Input
        type="number"
        min={1}
        max={300}
        value={data.delaySeconds ?? 1}
        onChange={(e) => update({ delaySeconds: Number(e.target.value) || 1 })}
      />
      <p className="text-[10px] text-muted-foreground">Wait before executing the next node (1–300s)</p>
    </div>
  );
}
