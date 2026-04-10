// Shared types for the flow builder

export interface ListRow {
  id: string;
  title: string;
  description?: string;
  header?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

export interface FlowButton {
  id: string;
  type: "reply" | "url" | "call" | "copy" | "list" | "catalog" | "location";
  text: string;
  url?: string;
  phoneNumber?: string;
  copyCode?: string;
  // List (single_select) fields
  listTitle?: string;
  listSections?: ListSection[];
}

export interface FlowNodeData {
  label?: string;
  // Trigger
  triggerMode?: "keyword" | "everyMessage" | "inactivitySession";
  keyword?: string;
  matchType?: "exact" | "contains" | "startsWith" | "regex";
  inactivitySeconds?: number;
  // Condition
  conditionField?: "message" | "sender";
  conditionOperator?: "equals" | "contains" | "startsWith" | "regex" | "notContains";
  conditionValue?: string;
  // Message
  messageText?: string;
  // Image
  imageSource?: "url" | "upload";
  imageUrl?: string;
  imageCaption?: string;
  imageAssetId?: string;
  imageMimeType?: string;
  imageFileName?: string;
  // Buttons
  buttonText?: string;
  buttonFooter?: string;
  buttons?: FlowButton[];
  // Delay
  delaySeconds?: number;
}

export interface FlowDefinition {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: FlowNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    label?: string;
  }>;
}

export interface ChatbotFlow {
  id: string;
  name: string;
  description?: string | null;
  flowData: FlowDefinition;
  enabled: boolean;
  priority: number;
}

export const NODE_COLORS = {
  trigger: { bg: "bg-emerald-500/10", border: "border-emerald-500", text: "text-emerald-700 dark:text-emerald-400", accent: "#10b981" },
  condition: { bg: "bg-amber-500/10", border: "border-amber-500", text: "text-amber-700 dark:text-amber-400", accent: "#f59e0b" },
  message: { bg: "bg-blue-500/10", border: "border-blue-500", text: "text-blue-700 dark:text-blue-400", accent: "#3b82f6" },
  image: { bg: "bg-cyan-500/10", border: "border-cyan-500", text: "text-cyan-700 dark:text-cyan-400", accent: "#06b6d4" },
  buttons: { bg: "bg-purple-500/10", border: "border-purple-500", text: "text-purple-700 dark:text-purple-400", accent: "#8b5cf6" },
  delay: { bg: "bg-gray-500/10", border: "border-gray-500", text: "text-gray-700 dark:text-gray-400", accent: "#6b7280" },
} as const;
