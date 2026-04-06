import { Zap, GitBranch, MessageSquare, MousePointerClick, Timer } from "lucide-react";
import { NODE_COLORS } from "./types";

interface NodeSidebarProps {
  onDragStart: (event: React.DragEvent, nodeType: string) => void;
}

const SIDEBAR_ITEMS = [
  { type: "trigger", label: "Trigger", icon: Zap, description: "Start when message matches", colors: NODE_COLORS.trigger },
  { type: "condition", label: "Condition", icon: GitBranch, description: "Branch on a condition", colors: NODE_COLORS.condition },
  { type: "message", label: "Send Message", icon: MessageSquare, description: "Send a text reply", colors: NODE_COLORS.message },
  { type: "buttons", label: "CTA Buttons", icon: MousePointerClick, description: "Send buttons (URL, call, reply)", colors: NODE_COLORS.buttons },
  { type: "delay", label: "Delay", icon: Timer, description: "Wait before continuing", colors: NODE_COLORS.delay },
] as const;

export function NodeSidebar({ onDragStart }: NodeSidebarProps) {
  return (
    <div className="w-56 border-r bg-card p-3 space-y-2 overflow-y-auto">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Drag to add
      </p>
      {SIDEBAR_ITEMS.map(({ type, label, icon: Icon, description, colors }) => (
        <div
          key={type}
          draggable
          onDragStart={(e) => onDragStart(e, type)}
          className={`cursor-grab active:cursor-grabbing rounded-lg border-2 ${colors.border} ${colors.bg} p-3 transition-all hover:shadow-md`}
        >
          <div className={`flex items-center gap-2 font-medium text-sm ${colors.text}`}>
            <Icon className="size-4 shrink-0" />
            {label}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        </div>
      ))}
    </div>
  );
}
