import { Suspense, lazy, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquareReply,
  Settings,
  Send,
  Users,
  Workflow,
  Zap,
  Wifi,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOut, useSession } from "@/lib/auth-client";
import { useApiUrl } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

const OverviewPage = lazy(() => import("./dashboard/OverviewPage"));
const ConnectionTab = lazy(() =>
  import("./dashboard/ConnectionTab").then((mod) => ({ default: mod.ConnectionTab }))
);
const ChatsTab = lazy(() =>
  import("./dashboard/ChatsTab").then((mod) => ({ default: mod.ChatsTab }))
);
const CommunitiesTab = lazy(() =>
  import("./dashboard/CommunitiesTab").then((mod) => ({ default: mod.CommunitiesTab }))
);
const BulkMessagesTab = lazy(() =>
  import("./dashboard/BulkMessagesTab").then((mod) => ({ default: mod.BulkMessagesTab }))
);
const ScheduleTab = lazy(() =>
  import("./dashboard/ScheduleTab").then((mod) => ({ default: mod.ScheduleTab }))
);
const AutoReplyTab = lazy(() =>
  import("./dashboard/AutoReplyTab").then((mod) => ({ default: mod.AutoReplyTab }))
);
const TemplatesTab = lazy(() =>
  import("./dashboard/TemplatesTab").then((mod) => ({ default: mod.TemplatesTab }))
);
const AIAssistantTab = lazy(() =>
  import("./dashboard/AIAssistantTab").then((mod) => ({ default: mod.AIAssistantTab }))
);
const FlowBuilderTab = lazy(() =>
  import("./dashboard/FlowBuilderTab").then((mod) => ({ default: mod.FlowBuilderTab }))
);
const SettingsTab = lazy(() =>
  import("./dashboard/SettingsTab").then((mod) => ({ default: mod.SettingsTab }))
);

type Page =
  | "overview"
  | "connection"
  | "chats"
  | "communities"
  | "bulk"
  | "schedule"
  | "auto-reply"
  | "flow-builder"
  | "templates"
  | "ai-assistant"
  | "settings";

type TabProps = { apiUrl: string; onNavigate?: (page: Page) => void };

const NAV_ITEMS: { id: Page; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, desc: "Dashboard stats" },
  { id: "connection", label: "Connection", icon: Wifi, desc: "WhatsApp link" },
  { id: "chats", label: "Chats", icon: MessageCircle, desc: "1:1 conversations" },
  { id: "communities", label: "Communities", icon: Users, desc: "Groups & channels" },
  { id: "bulk", label: "Bulk Messages", icon: Send, desc: "Send to many" },
  { id: "schedule", label: "Scheduled", icon: CalendarClock, desc: "Timed messages" },
  { id: "auto-reply", label: "Auto Reply", icon: MessageSquareReply, desc: "Auto responses" },
  { id: "flow-builder", label: "Flows", icon: Workflow, desc: "Automation flows" },
  { id: "templates", label: "Templates", icon: FileText, desc: "Message templates" },
  { id: "ai-assistant", label: "AI Assistant", icon: Zap, desc: "AI powered replies" },
  { id: "settings", label: "Settings", icon: Settings, desc: "Chat data preferences" },
];

const PAGE_TITLES: Record<Page, string> = {
  overview: "Overview",
  connection: "Connection",
  chats: "Chats",
  communities: "Communities",
  bulk: "Bulk Messages",
  schedule: "Scheduled Messages",
  "auto-reply": "Auto Reply",
  "flow-builder": "Flow Builder",
  templates: "Templates",
  "ai-assistant": "AI Assistant",
  settings: "Settings",
};

const PAGE_COMPONENTS: Record<Page, React.ComponentType<TabProps>> = {
  overview: OverviewPage,
  connection: ConnectionTab,
  chats: ChatsTab,
  communities: CommunitiesTab,
  bulk: BulkMessagesTab,
  schedule: ScheduleTab,
  "auto-reply": AutoReplyTab,
  "flow-builder": FlowBuilderTab,
  templates: TemplatesTab,
  "ai-assistant": AIAssistantTab,
  settings: SettingsTab,
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const apiUrl = useApiUrl();
  const [activePage, setActivePage] = useState<Page>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const ActivePage = PAGE_COMPONENTS[activePage];

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleSelect = (id: Page) => {
    setActivePage(id);
    setMobileNavOpen(false);
  };

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="wa-header flex h-[56px] shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* Mobile menu */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="flex size-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
              <svg viewBox="0 0 24 24" className="size-5 fill-current text-white">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.77.46 3.43 1.27 4.88L2 22l5.12-1.27C8.57 21.54 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.01 18c-1.61 0-3.09-.46-4.36-1.24l-.31-.19-3.03.75.76-2.94-.2-.32A7.963 7.963 0 014 12c0-4.42 3.58-8 8.01-8 4.42 0 8 3.58 8 8s-3.59 8-8 8z"/>
              </svg>
            </div>
            <span className="hidden text-[15px] font-semibold text-white sm:block">WhatsApp Bot</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSignOut}
            className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white/90 transition-colors hover:bg-white/20"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <nav 
            className="wa-scrollbar h-full w-72 overflow-y-auto bg-white dark:bg-[#111b21]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between border-b px-4 dark:border-[#233138]">
              <span className="text-sm font-semibold text-foreground">Menu</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="wa-icon-btn"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            
            {/* User info */}
            <div className="border-b p-4 dark:border-[#233138]">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{user?.name ?? "User"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>

            {/* Nav items */}
            <div className="py-2">
              {NAV_ITEMS.map(({ id, label, icon: Icon, desc }) => {
                const active = activePage === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleSelect(id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                      active
                        ? "bg-primary/10"
                        : "hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("size-5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <span className={cn("block text-sm", active ? "font-medium text-foreground" : "text-foreground")}>
                        {label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{desc}</span>
                    </div>
                    {active && <ChevronRight className="size-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="wa-sidebar hidden w-64 shrink-0 flex-col border-r md:flex lg:w-72">
          {/* User section */}
          <div className="flex items-center gap-3 border-b p-4 dark:border-[#233138]">
            <Avatar className="size-11">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{user?.name ?? "User"}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="wa-scrollbar flex-1 overflow-y-auto py-2">
            {NAV_ITEMS.map(({ id, label, icon: Icon, desc }) => {
              const active = activePage === id;
              return (
                <button
                  key={id}
                  onClick={() => handleSelect(id)}
                  className={cn(
                    "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                    active
                      ? "bg-primary/10 border-r-2 border-primary"
                      : "hover:bg-muted"
                  )}
                >
                  <div className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                    active ? "bg-primary text-white" : "bg-muted text-muted-foreground group-hover:text-foreground"
                  )}>
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className={cn(
                      "block text-sm leading-tight",
                      active ? "font-semibold text-foreground" : "text-foreground"
                    )}>
                      {label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{desc}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Footer hint */}
          <div className="border-t p-3 dark:border-[#233138]">
            <p className="text-center text-xs text-muted-foreground">
              Signing out won't stop the bot
            </p>
          </div>
        </aside>

        {/* Main content */}
        <main className="wa-doodle-bg relative flex-1 overflow-hidden">
          {/* Scrollable content */}
          <div className="wa-scrollbar relative z-10 h-full overflow-y-auto">
            <div className="mx-auto max-w-6xl p-5 lg:p-8">
              <Suspense
                fallback={
                  <div className="wa-card wa-animate-in flex items-center gap-3 p-5">
                    <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-sm text-muted-foreground">
                      Loading {PAGE_TITLES[activePage]}...
                    </span>
                  </div>
                }
              >
                <ActivePage apiUrl={apiUrl} onNavigate={setActivePage} />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
