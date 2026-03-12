import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, GitBranch, MessageSquare, MousePointerClick, Timer } from "lucide-react";
import { NODE_COLORS, type FlowNodeData } from "./types";

const HANDLE_STYLE = { width: 10, height: 10, borderRadius: "50%" };

// ─── Trigger Node ─────────────────────────────────────────────────────────────

function TriggerNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.trigger;
  return (
    <div className={`rounded-lg border-2 ${c.border} ${c.bg} px-4 py-3 min-w-[200px] shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className={`flex items-center gap-2 font-semibold text-sm ${c.text} mb-1`}>
        <Zap className="size-4" />
        Trigger
      </div>
      <div className="text-xs text-muted-foreground">
        {d.keyword ? (
          <>
            <span className="font-medium">"{d.keyword}"</span>
            <span className="ml-1 opacity-70">({d.matchType ?? "contains"})</span>
          </>
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

// ─── Buttons Node ─────────────────────────────────────────────────────────────

function ButtonsNodeComponent({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const c = NODE_COLORS.buttons;
  const buttonCount = d.buttons?.length ?? 0;
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
            <p className="opacity-70">{buttonCount} button{buttonCount !== 1 ? "s" : ""}</p>
          </>
        ) : (
          <span className="italic">Click to configure</span>
        )}
      </div>
      {buttonCount > 0 && (
        <div className="mt-1.5 space-y-1">
          {d.buttons!.slice(0, 3).map((btn) => (
            <div key={btn.id} className="flex items-center gap-1 text-[10px] bg-background/50 rounded px-1.5 py-0.5">
              <span className={`size-1.5 rounded-full ${btn.type === "url" ? "bg-blue-400" : btn.type === "call" ? "bg-green-400" : "bg-gray-400"}`} />
              {btn.text}
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, background: c.accent }} />
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
export const ButtonsNode = memo(ButtonsNodeComponent);
export const DelayNode = memo(DelayNodeComponent);

export const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  message: MessageNode,
  buttons: ButtonsNode,
  delay: DelayNode,
};
