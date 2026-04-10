export type DashboardChatType = "direct" | "group" | "broadcast" | "channel";

export type DashboardChatScope = "direct" | "communities" | "all" | DashboardChatType;

export interface DashboardChat {
  id: string;
  title: string;
  type: DashboardChatType;
  target: string;
  contactId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  isPinned: boolean;
  isArchived: boolean;
  messageCount: number;
}
