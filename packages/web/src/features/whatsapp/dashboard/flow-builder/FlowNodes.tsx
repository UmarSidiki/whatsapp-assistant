import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, GitBranch, MessageSquare, MousePointerClick, Timer, Image as ImageIcon } from "lucide-react";
import { NODE_COLORS, type FlowNodeData } from "./types";

const HANDLE_STYLE = { width: 10, height: 10, borderRadius: "50%" };

function formatInactivity(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

// ─── Trigger Node ─────────────────────────────────────────────────────────────

function TriggerNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.trigger;
  const triggerMode = d.triggerMode ?? "keyword";
  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[200px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <Zap className="size-4" />
        Trigger
      </div>
      <div className="text-xs text-muted-foreground">
        {triggerMode === "keyword" && d.keyword ? (
          <>
            <span className="font-medium">"{d.keyword}"</span>
            <span className="ml-1 opacity-70">({d.matchType ?? "contains"})</span>
          </>
        ) : triggerMode === "everyMessage" ? (
          <span className="font-medium">Every incoming message</span>
        ) : triggerMode === "inactivitySession" ? (
          <span className="font-medium">
            After {formatInactivity(d.inactivitySeconds ?? 12 * 60 * 60)} inactivity, then every message
          </span>
        ) : (
          <span className="italic">Click to configure</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: c.accent }} />
    </div>
  );
}

// ─── Condition Node ───────────────────────────────────────────────────────────

function ConditionNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.condition;
  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[200px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: c.accent }} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <GitBranch className="size-4" />
        Condition
      </div>
      <div className="text-xs text-muted-foreground">
        {d.conditionValue ? (
          <>
            <span className="opacity-70">{d.conditionField ?? "message"} </span>
            <span className="font-medium">{d.conditionOperator ?? "contains"} </span>
            <span>"{d.conditionValue}"</span>
          </>
        ) : (
          <span className="italic">Click to configure</span>
        )}
      </div>
      <div className="flex justify-between mt-2">
        <div className="relative">
          <span className="text-[10px] font-medium text-emerald-600">Yes</span>
          <Handle type="source" position={Position.Bottom} id="yes" style={{ ...HANDLE_STYLE, background: "#10b981", left: 15, bottom: -12 }} />
        </div>
        <div className="relative">
          <span className="text-[10px] font-medium text-red-500">No</span>
          <Handle type="source" position={Position.Bottom} id="no" style={{ ...HANDLE_STYLE, background: "#ef4444", left: 5, bottom: -12 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Message Node ─────────────────────────────────────────────────────────────

function MessageNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.message;
  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[200px] max-w-[280px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: c.accent }} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <MessageSquare className="size-4" />
        Send Message
      </div>
      <div className="text-xs text-muted-foreground line-clamp-3">
        {d.messageText || <span className="italic">Click to configure</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: c.accent }} />
    </div>
  );
}

// ─── Image Node ───────────────────────────────────────────────────────────────

function ImageNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.image;
  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[200px] max-w-[280px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: c.accent }} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <ImageIcon className="size-4" />
        Send Image
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        {d.imageUrl || d.imageAssetId ? (
          <>
            <p className="font-medium">
              {d.imageSource === "upload" ? d.imageFileName || "Uploaded image" : "Image URL"}
            </p>
            {d.imageCaption ? <p className="line-clamp-2">{d.imageCaption}</p> : <p className="opacity-70">No caption</p>}
          </>
        ) : (
          <span className="italic">Click to configure</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: c.accent }} />
    </div>
  );
}

// ─── Buttons Node ─────────────────────────────────────────────────────────────

function ButtonsNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.buttons;
  const buttons = d.buttons ?? [];
  const replyButtons = buttons.filter((b) => b.type === "reply");

  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[200px] max-w-[280px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: c.accent }} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <MousePointerClick className="size-4" />
        CTA Buttons
      </div>
      <div className="text-xs text-muted-foreground">
        {d.buttonText ? (
          <>
            <p className="line-clamp-2 mb-1">{d.buttonText}</p>
            <p className="opacity-70">{buttons.length} button{buttons.length !== 1 ? "s" : ""}</p>
          </>
        ) : (
          <span className="italic">Click to configure</span>
        )}
      </div>
      {buttons.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {buttons.slice(0, 3).map((btn) => (
            <div key={btn.id} className="flex items-center gap-1 text-[10px] bg-background/50 rounded px-1.5 py-0.5">
              <span className={`size-1.5 rounded-full ${btn.type === "url" ? "bg-blue-400" : btn.type === "call" ? "bg-green-400" : btn.type === "copy" ? "bg-orange-400" : btn.type === "list" ? "bg-cyan-400" : btn.type === "catalog" ? "bg-yellow-400" : btn.type === "location" ? "bg-teal-400" : "bg-purple-400"}`} />
              {btn.text || "Untitled"}
            </div>
          ))}
          {buttons.length > 3 && (
            <div className="text-[10px] opacity-50">+{buttons.length - 3} more</div>
          )}
        </div>
      )}
      {/* Per-reply-button output handles for branching */}
      {replyButtons.length > 0 ? (
        <div className="flex justify-between mt-2 gap-2">
          {replyButtons.map((btn, i) => (
            <div key={btn.id} className="relative flex flex-col items-center">
              <span className="text-[9px] font-medium text-purple-500 max-w-[60px] truncate block">
                {btn.text || `Reply ${i + 1}`}
              </span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={`btn_${btn.id}`}
                style={{ ...HANDLE_STYLE, background: "#8b5cf6", left: "50%", bottom: -12 }}
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: c.accent }} />
      )}
    </div>
  );
}

// ─── Delay Node ───────────────────────────────────────────────────────────────

function DelayNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.delay;
  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[160px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, background: c.accent }} />
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <Timer className="size-4" />
        Delay
      </div>
      <div className="text-xs text-muted-foreground">
        {d.delaySeconds ? `${d.delaySeconds}s` : <span className="italic">Click to configure</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: c.accent }} />
    </div>
  );
}

export const TriggerNode = memo(TriggerNodeComponent);
export const ConditionNode = memo(ConditionNodeComponent);
export const MessageNode = memo(MessageNodeComponent);
export const ImageNode = memo(ImageNodeComponent);
export const ButtonsNode = memo(ButtonsNodeComponent);
export const DelayNode = memo(DelayNodeComponent);

export const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  message: MessageNode,
  image: ImageNode,
  buttons: ButtonsNode,
  delay: DelayNode,
};
