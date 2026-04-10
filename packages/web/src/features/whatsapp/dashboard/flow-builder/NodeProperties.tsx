import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import type { FlowNodeData, FlowButton, ListSection, ListRow } from "./types";
import { NODE_COLORS } from "./types";

interface NodePropertiesProps {
  apiUrl: string;
  nodeId: string;
  nodeType: string;
  data: FlowNodeData;
  onChange: (nodeId: string, data: FlowNodeData) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
}

export function NodeProperties({ apiUrl, nodeId, nodeType, data, onChange, onClose, onDelete }: NodePropertiesProps) {
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
        {nodeType === "image" && <ImageFields apiUrl={apiUrl} data={local} update={update} />}
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
  const triggerMode = data.triggerMode ?? "keyword";
  const inactivitySeconds = Math.max(60, data.inactivitySeconds ?? 12 * 60 * 60);
  const inactivityPresets = [
    { label: "12 hours", value: 12 * 60 * 60 },
    { label: "24 hours", value: 24 * 60 * 60 },
    { label: "2 days", value: 2 * 24 * 60 * 60 },
    { label: "7 days", value: 7 * 24 * 60 * 60 },
  ] as const;
  const selectedPreset = inactivityPresets.find((preset) => preset.value === inactivitySeconds);

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Trigger Mode</Label>
        <Select
          value={triggerMode}
          onValueChange={(v) =>
            update({
              triggerMode: v as FlowNodeData["triggerMode"],
              ...(v !== "keyword" ? { keyword: "", matchType: "contains" } : {}),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyword">Keyword match</SelectItem>
            <SelectItem value="everyMessage">Every message</SelectItem>
            <SelectItem value="inactivitySession">Inactivity session</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {triggerMode === "keyword" && (
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
          <p className="text-[10px] text-muted-foreground bg-muted/40 rounded p-1.5 border">
            Flow starts when message text matches your keyword rule.
          </p>
        </>
      )}

      {triggerMode === "everyMessage" && (
        <p className="text-[10px] text-muted-foreground bg-muted/40 rounded p-1.5 border">
          Flow runs on every incoming message from the contact.
        </p>
      )}

      {triggerMode === "inactivitySession" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Inactivity window</Label>
            <Select
              value={selectedPreset ? String(selectedPreset.value) : "custom"}
              onValueChange={(v) => {
                if (v === "custom") return;
                update({ inactivitySeconds: Number(v) });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {inactivityPresets.map((preset) => (
                  <SelectItem key={preset.value} value={String(preset.value)}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!selectedPreset && (
            <div className="space-y-1.5">
              <Label className="text-xs">Custom inactivity (minutes)</Label>
              <Input
                type="number"
                min={1}
                value={Math.max(1, Math.round(inactivitySeconds / 60))}
                onChange={(e) => {
                  const minutes = Math.max(1, Number(e.target.value) || 1);
                  update({ inactivitySeconds: minutes * 60 });
                }}
              />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground bg-emerald-500/5 rounded p-1.5 border border-emerald-500/20">
            First message after this inactivity window triggers the flow, then every subsequent message keeps triggering until the inactivity gap exceeds this window again.
          </p>
        </>
      )}
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

function ImageFields({
  apiUrl,
  data,
  update,
}: {
  apiUrl: string;
  data: FlowNodeData;
  update: (p: Partial<FlowNodeData>) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const source = data.imageSource ?? "url";
  const previewUrl = data.imageUrl
    ? /^https?:\/\//i.test(data.imageUrl)
      ? data.imageUrl
      : `${apiUrl}${data.imageUrl}`
    : "";

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${apiUrl}/api/whatsapp/flows/upload-image`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(payload.message || "Image upload failed.");
        return;
      }

      update({
        imageSource: "upload",
        imageAssetId: payload.assetId,
        imageUrl: payload.imageUrl,
        imageMimeType: payload.mimeType,
        imageFileName: payload.fileName,
      });
    } catch {
      setUploadError("Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Image source</Label>
        <Select value={source} onValueChange={(v) => update({ imageSource: v as FlowNodeData["imageSource"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="url">Image URL</SelectItem>
            <SelectItem value="upload">Upload file</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {source === "url" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Image URL</Label>
          <Input
            placeholder="https://example.com/image.jpg"
            value={data.imageUrl ?? ""}
            onChange={(e) => update({ imageUrl: e.target.value })}
          />
        </div>
      )}

      {source === "upload" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Upload image</Label>
          <Input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void uploadFile(file);
              e.currentTarget.value = "";
            }}
          />
          {uploading && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Uploading image…
            </p>
          )}
          {data.imageFileName && !uploading && (
            <p className="text-[10px] text-muted-foreground">Uploaded: {data.imageFileName}</p>
          )}
          {uploadError && <p className="text-[10px] text-destructive">{uploadError}</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Caption (optional)</Label>
        <Textarea
          placeholder="Add a caption for this image…"
          rows={3}
          value={data.imageCaption ?? ""}
          onChange={(e) => update({ imageCaption: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground">
          Variables: <code>{"{message}"}</code>, <code>{"{sender}"}</code>, <code>{"{phone}"}</code>
        </p>
      </div>

      {previewUrl && (
        <div className="space-y-1.5">
          <Label className="text-xs">Preview</Label>
          <img
            src={previewUrl}
            alt="Flow image preview"
            className="w-full max-h-44 object-contain rounded border bg-muted/20"
          />
        </div>
      )}
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
                <SelectTrigger className="h-7 text-xs w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reply">Reply</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="copy">Copy Code</SelectItem>
                  <SelectItem value="list">List Menu</SelectItem>
                  <SelectItem value="catalog">Catalog</SelectItem>
                  <SelectItem value="location">Location</SelectItem>
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
            {btn.type === "copy" && (
              <Input
                className="h-7 text-xs"
                placeholder="Code to copy (e.g. DISCOUNT20)"
                value={btn.copyCode ?? ""}
                onChange={(e) => updateButton(idx, { copyCode: e.target.value })}
              />
            )}
            {btn.type === "list" && (
              <ListButtonEditor
                btn={btn}
                onChange={(patch) => updateButton(idx, patch)}
              />
            )}
          </div>
        ))}
        {buttons.some((b) => b.type === "reply") && (
          <p className="text-[10px] text-muted-foreground bg-purple-500/5 rounded p-1.5 border border-purple-500/20">
            💡 Reply buttons create per-button output handles on the node. Connect each handle to a different branch to route based on which button the user clicks.
          </p>
        )}
      </div>
    </>
  );
}

function ListButtonEditor({ btn, onChange }: { btn: FlowButton; onChange: (patch: Partial<FlowButton>) => void }) {
  const sections = btn.listSections ?? [];

  const addSection = () => {
    const newSection: ListSection = { title: "", rows: [{ id: crypto.randomUUID(), title: "", description: "" }] };
    onChange({ listSections: [...sections, newSection] });
  };

  const updateSection = (sIdx: number, patch: Partial<ListSection>) => {
    const updated = sections.map((s, i) => (i === sIdx ? { ...s, ...patch } : s));
    onChange({ listSections: updated });
  };

  const removeSection = (sIdx: number) => {
    onChange({ listSections: sections.filter((_, i) => i !== sIdx) });
  };

  const addRow = (sIdx: number) => {
    const newRow: ListRow = { id: crypto.randomUUID(), title: "", description: "" };
    const updated = sections.map((s, i) =>
      i === sIdx ? { ...s, rows: [...s.rows, newRow] } : s
    );
    onChange({ listSections: updated });
  };

  const updateRow = (sIdx: number, rIdx: number, patch: Partial<ListRow>) => {
    const updated = sections.map((s, si) =>
      si === sIdx
        ? { ...s, rows: s.rows.map((r, ri) => (ri === rIdx ? { ...r, ...patch } : r)) }
        : s
    );
    onChange({ listSections: updated });
  };

  const removeRow = (sIdx: number, rIdx: number) => {
    const updated = sections.map((s, si) =>
      si === sIdx ? { ...s, rows: s.rows.filter((_, ri) => ri !== rIdx) } : s
    );
    onChange({ listSections: updated });
  };

  return (
    <div className="space-y-2 pl-1 border-l-2 border-blue-500/30">
      <Input
        className="h-7 text-xs"
        placeholder="Menu title (e.g. Choose an option)"
        value={btn.listTitle ?? ""}
        onChange={(e) => onChange({ listTitle: e.target.value })}
      />
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-1.5 rounded border bg-muted/30 p-1.5">
          <div className="flex items-center gap-1">
            <Input
              className="h-6 text-[11px] flex-1"
              placeholder="Section title"
              value={section.title ?? ""}
              onChange={(e) => updateSection(sIdx, { title: e.target.value })}
            />
            <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={() => removeSection(sIdx)}>
              <X className="size-3 text-destructive" />
            </Button>
          </div>
          {section.rows.map((row, rIdx) => (
            <div key={row.id} className="flex items-start gap-1 pl-2">
              <div className="flex-1 space-y-1">
                <Input
                  className="h-6 text-[11px]"
                  placeholder="Row title"
                  value={row.title}
                  onChange={(e) => updateRow(sIdx, rIdx, { title: e.target.value })}
                />
                <Input
                  className="h-6 text-[11px]"
                  placeholder="Description (optional)"
                  value={row.description ?? ""}
                  onChange={(e) => updateRow(sIdx, rIdx, { description: e.target.value })}
                />
              </div>
              <Button variant="ghost" size="icon" className="size-5 shrink-0 mt-0.5" onClick={() => removeRow(sIdx, rIdx)}>
                <Trash2 className="size-2.5 text-destructive" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 w-full" onClick={() => addRow(sIdx)}>
            <Plus className="size-2.5 mr-0.5" /> Add Row
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 w-full" onClick={addSection}>
        <Plus className="size-2.5 mr-0.5" /> Add Section
      </Button>
    </div>
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
