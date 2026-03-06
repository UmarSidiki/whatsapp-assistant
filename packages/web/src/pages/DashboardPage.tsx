import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Wifi,
  Send,
  CalendarClock,
  MessageSquareReply,
  FileText,
  Menu,
  LogOut,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut, useSession } from "@/lib/auth-client";
import { useApiUrl } from "@/hooks/useApi";
import OverviewPage from "./dashboard/OverviewPage";
import { ConnectionTab } from "./dashboard/ConnectionTab";
import { BulkMessagesTab } from "./dashboard/BulkMessagesTab";
import { ScheduleTab } from "./dashboard/ScheduleTab";
import { AutoReplyTab } from "./dashboard/AutoReplyTab";
import { TemplatesTab } from "./dashboard/TemplatesTab";
import { AIAssistantTab } from "./dashboard/AIAssistantTab";

type Page = "overview" | "connection" | "bulk" | "schedule" | "auto-reply" | "templates" | "ai-assistant";

const NAV_ITEMS: { id: Page; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "connection", label: "Connection", icon: Wifi },
  { id: "bulk", label: "Bulk Messages", icon: Send },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "auto-reply", label: "Auto Reply", icon: MessageSquareReply },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "ai-assistant", label: "AI Assistant", icon: Zap },
];

const PAGE_TITLES: Record<Page, string> = {
  overview: "Overview",
  connection: "Connection",
  bulk: "Bulk Messages",
  schedule: "Schedule",
  "auto-reply": "Auto Reply",
  templates: "Templates",
  "ai-assistant": "AI Assistant",
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const apiUrl = useApiUrl();
  const [activePage, setActivePage] = useState<Page>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const user = session?.user;
  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3 md:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">WhatsApp Bot</h1>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
            >
              <Menu className="size-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation - Desktop */}
        <nav className="hidden w-56 flex-col border-r bg-card md:flex">
          <div className="space-y-2 p-4">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={activePage === id ? "default" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => {
                  setActivePage(id);
                  setMobileNavOpen(false);
                }}
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </Button>
            ))}
          </div>
        </nav>

        {/* Mobile Navigation */}
        {mobileNavOpen && (
          <nav className="absolute top-16 left-0 right-0 z-40 border-b bg-card p-2 md:hidden">
            <div className="space-y-1">
              {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={activePage === id ? "default" : "ghost"}
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setActivePage(id);
                    setMobileNavOpen(false);
                  }}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </Button>
              ))}
            </div>
          </nav>
        )}

        {/* Content Area */}
        <main className="flex-1 overflow-auto">
          <div className="space-y-6 p-4 md:p-6">
            <div>
              <h2 className="text-2xl font-bold">{PAGE_TITLES[activePage]}</h2>
            </div>
            {activePage === "overview" && <OverviewPage apiUrl={apiUrl} />}
            {activePage === "connection" && <ConnectionTab apiUrl={apiUrl} />}
            {activePage === "bulk" && <BulkMessagesTab apiUrl={apiUrl} />}
            {activePage === "schedule" && <ScheduleTab apiUrl={apiUrl} />}
            {activePage === "auto-reply" && <AutoReplyTab apiUrl={apiUrl} />}
            {activePage === "templates" && <TemplatesTab apiUrl={apiUrl} />}
            {activePage === "ai-assistant" && <AIAssistantTab apiUrl={apiUrl} />}
          </div>
        </main>
      </div>
    </div>
  );
}
