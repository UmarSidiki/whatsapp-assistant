import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

type AIStatus = "ready" | "mimicking" | "off";

const STATUS_CONFIG: Record<AIStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ready: { label: "AI: Ready", variant: "default" },
  mimicking: { label: "AI: Mimicking", variant: "secondary" },
  off: { label: "AI: Off", variant: "outline" },
};

/**
 * Small badge component for displaying AI assistant status in chat headers
 * @param status - Current AI status ('ready', 'mimicking', 'off')
 * @param onClick - Callback when badge is clicked to open AI settings
 */
export function AIStatusBadge({ status = "off", onClick }: { status?: AIStatus; onClick?: () => void }) {
  const config = STATUS_CONFIG[status];

  return (
    <Badge
      variant={config.variant}
      className="cursor-pointer gap-1.5 px-2 py-1"
      onClick={onClick}
    >
      <Zap className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
