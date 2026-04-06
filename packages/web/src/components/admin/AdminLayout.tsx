import { useState, type ReactNode, type ComponentType } from "react";
import {
  ChevronRight,
  Menu,
  Shield,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type AdminNavItem<T extends string> = {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
};

type AdminLayoutProps<T extends string> = {
  title: string;
  subtitle: string;
  navItems: AdminNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  userName?: string | null;
  children: ReactNode;
};

export function AdminLayout<T extends string>({
  title,
  subtitle: _subtitle,
  navItems,
  activeId,
  onSelect,
  userName,
  children,
}: AdminLayoutProps<T>) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  void _subtitle; // Reserved for future use

  const initials = userName
    ? userName
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "AD";

  const handleSelect = (id: T) => {
    onSelect(id);
    setMobileNavOpen(false);
  };

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="wa-header flex h-14 shrink-0 items-center justify-between px-4">
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
              <Shield className="size-5 text-white" />
            </div>
            <span className="hidden text-[15px] font-semibold text-white sm:block">{title}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
              <span className="text-sm font-semibold text-foreground">{title}</span>
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
                  <p className="truncate font-medium text-foreground">{userName ?? "Admin"}</p>
                  <p className="truncate text-xs text-muted-foreground">Administrator</p>
                </div>
              </div>
            </div>

            {/* Nav items */}
            <div className="py-2">
              {navItems.map(({ id, label, icon: Icon, description }) => {
                const active = activeId === id;
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
                      {description && (
                        <span className="block truncate text-xs text-muted-foreground">{description}</span>
                      )}
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
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{userName ?? "Admin"}</p>
              <p className="truncate text-xs text-muted-foreground">Administrator</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="wa-scrollbar flex-1 overflow-y-auto py-2">
            {navItems.map(({ id, label, icon: Icon, description }) => {
              const active = activeId === id;
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
                    <span className="block text-xs text-muted-foreground">
                      {description ?? (active ? "Current section" : "Click to view")}
                    </span>
                  </div>
                </button>
              );
            })}
          </nav>


        </aside>

        {/* Main content */}
        <main className="wa-doodle-bg relative flex-1 overflow-hidden">
          {/* Scrollable content */}
          <div className="wa-scrollbar relative z-10 h-full overflow-y-auto">
            <div className="mx-auto max-w-6xl p-5 lg:p-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
