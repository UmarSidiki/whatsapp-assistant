import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  SquareStack,
  UserCog,
  Users,
  Wifi,
  WifiOff,
  XCircle,
  FileClock,
  PanelTopOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiResponseError } from "@/lib/api-utils";
import {
  bulkSetUserSuspension,
  bulkUpdateUserRole,
  fetchAdminOverview,
  fetchAdminUserDetails,
  fetchAdminUsers,
  fetchAuditLogs,
  fetchBillingInvoices,
  fetchBillingSubscriptions,
  fetchSecurityEvents,
  fetchSecuritySessions,
  fetchSystemHealth,
  fetchTrials,
  fetchWhatsappOps,
  revokeSecuritySession,
  suspendUser,
  unsuspendUser,
  updateInvoiceStatus,
  updateSubscriptionStatus,
  updateUserRole,
  type AdminUserDetails,
  type AdminOverview,
  type AdminUserListItem,
  type AdminUsersResponse,
  type AuditLog,
  type InvoiceResponse,
  type SecurityEvent,
  type SecuritySession,
  type SubscriptionResponse,
  type SystemHealth,
  type TrialUsageRecord,
  type TrialsResponse,
  type WhatsappOpsSnapshot,
} from "./admin-api";

type PanelProps = {
  apiUrl: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

function formatCurrency(amount: number, currency: string | null | undefined) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency ?? "USD"} ${amount.toFixed(2)}`;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof ApiResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

function PanelHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="wa-card wa-animate-in flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
        <h3 className="text-xl font-bold text-foreground">{title}</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="wa-card wa-animate-in overflow-hidden">
      <div className="border-b px-5 py-4 dark:border-[#233138]">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {badge ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{badge}</span>
          ) : null}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accentClass = "bg-primary/15 text-primary",
}: {
  label: string;
  value: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  accentClass?: string;
}) {
  return (
    <div className="wa-card wa-animate-in p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${accentClass}`}>
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}

function LoadingState({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="wa-card p-4">
            <div className="wa-skeleton mb-3 h-3 w-20" />
            <div className="wa-skeleton mb-2 h-7 w-24" />
            <div className="wa-skeleton h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="wa-skeleton h-72 w-full" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className="wa-skeleton h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="wa-card wa-animate-in border-l-4 border-destructive p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-5 text-destructive" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Failed to load</h4>
            <p className="mt-0.5 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
        <Button onClick={onRetry} variant="outline" className="gap-2">
          <RefreshCw className="size-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  icon: Icon = SquareStack,
}: {
  title: string;
  description: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="wa-card wa-animate-in flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h4 className="text-base font-semibold text-foreground">{title}</h4>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function BadgePill({
  variant,
  children,
}: {
  variant?: "default" | "secondary" | "outline" | "destructive";
  children: ReactNode;
}) {
  return <Badge variant={variant}>{children}</Badge>;
}

function statusBadgeVariant(status: string) {
  if (["ok", "active", "connected", "paid", "success", "healthy", "admin"].includes(status))
    return "default";
  if (["degraded", "warning", "pending", "trial", "waiting", "inactive", "queued"].includes(status))
    return "secondary";
  if (["down", "failed", "disconnected", "error", "suspended", "expired"].includes(status))
    return "destructive";
  return "outline";
}

const USER_ROLE_OPTIONS: AdminUserListItem["role"][] = ["user", "admin"];

const BILLING_STATUS_OPTIONS = ["active", "past_due", "canceled", "trialing", "paid", "open", "void", "unpaid"];
const USER_PAGE_SIZE = 25;
const AUTO_REFRESH_SECONDS_OPTIONS = [30, 60, 300] as const;

function confirmAction(message: string) {
  if (typeof window === "undefined") return true;
  return window.confirm(message);
}

function ActionLoading({ label }: { label: string }) {
  return (
    <>
      <Loader2 className="size-4 animate-spin" />
      {label}
    </>
  );
}

function toCsvValue(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadFile(fileName: string, content: string, mimeType: string) {
  if (typeof window === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ResponsiveTableShell({ children }: { children: ReactNode }) {
  return <div className="hidden overflow-x-auto rounded-lg border dark:border-[#233138] md:block">{children}</div>;
}

function OverviewMetricGrid({ overview, health }: { overview: AdminOverview; health: SystemHealth }) {
  const revenueLabel = formatCurrency(overview.revenue.totalInvoiceAmount, overview.revenue.currency);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Active organizations"
        value={overview.totalUsers.toLocaleString()}
        detail="Total accounts with access to the platform"
        icon={Users}
      />
      <MetricCard
        label="WhatsApp connections"
        value={overview.activeWaConnections.toLocaleString()}
        detail={`${health.whatsapp.connectedSessions.toLocaleString()} sessions connected right now`}
        icon={Bot}
      />
      <MetricCard
        label="Trials tracked"
        value={overview.trialRecordsCount.toLocaleString()}
        detail="Trial records available to review"
        icon={CalendarRange}
      />
      <MetricCard
        label="Revenue tracked"
        value={revenueLabel}
        detail={`${overview.revenue.activeSubscriptions.toLocaleString()} active subscriptions`}
        icon={CreditCard}
      />
    </div>
  );
}

function UserRowCard({
  apiUrl,
  user,
  canEditRoles,
  isSelected,
  onToggleSelected,
  onViewDetails,
  onUpdated,
  onError,
}: {
  apiUrl: string;
  user: AdminUserListItem;
  canEditRoles: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onViewDetails: (userId: string) => void;
  onUpdated: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState<AdminUserListItem["role"]>(user.role);
  const [savingRole, setSavingRole] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  const roleChanged = role !== user.role;
  const isSuspended = Boolean(user.suspendedAt);

  const saveRole = async () => {
    if (!roleChanged || !canEditRoles) return;
    if (
      !confirmAction(
        `Change ${user.name ?? user.email ?? user.id}'s role from ${user.role} to ${role}?`
      )
    ) {
      return;
    }

    setSavingRole(true);
    try {
      await updateUserRole(apiUrl, user.id, role);
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSavingRole(false);
    }
  };

  const toggleSuspension = async () => {
    if (
      !confirmAction(
        isSuspended
          ? `Unsuspend ${user.name ?? user.email ?? user.id}?`
          : `Suspend ${user.name ?? user.email ?? user.id}?`
      )
    ) {
      return;
    }

    setToggleLoading(true);
    try {
      if (isSuspended) {
        await unsuspendUser(apiUrl, user.id);
      } else {
        await suspendUser(apiUrl, user.id);
      }
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setToggleLoading(false);
    }
  };

  return (
    <tr key={user.id} className="align-top">
      <td className="py-4 pr-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          aria-label={`Select ${user.name ?? user.email ?? user.id}`}
          className="size-4 rounded border-border"
        />
      </td>
      <td className="py-4 pr-4">
        <div className="space-y-1">
          <p className="font-medium">{user.name ?? "Unnamed user"}</p>
          <p className="text-muted-foreground">{user.email ?? "No email"}</p>
        </div>
      </td>
      <td className="py-4 pr-4">
        {canEditRoles ? (
          <div className="flex min-w-36 items-center gap-2">
            <Select value={role} onValueChange={(value) => setRole(value as AdminUserListItem["role"])}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void saveRole()}
              disabled={!roleChanged || savingRole}
              className="shrink-0"
            >
              {savingRole ? <ActionLoading label="Saving" /> : "Update"}
            </Button>
          </div>
        ) : (
          <BadgePill variant={statusBadgeVariant(user.role)}>{user.role}</BadgePill>
        )}
      </td>
      <td className="py-4 pr-4 text-muted-foreground">{user.tier ?? "—"}</td>
      <td className="py-4 pr-4">
        {user.suspendedAt ? (
          <BadgePill variant="destructive">Suspended</BadgePill>
        ) : (
          <BadgePill variant="secondary">Active</BadgePill>
        )}
      </td>
      <td className="py-4 pr-4 text-muted-foreground">{formatDate(user.createdAt)}</td>
      <td className="py-4 pr-4">
        <div className="flex min-w-40 flex-col gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onViewDetails(user.id)}>
            <Eye className="size-4" />
            Details
          </Button>
          <Button
            type="button"
            size="sm"
            variant={isSuspended ? "secondary" : "destructive"}
            onClick={() => void toggleSuspension()}
            disabled={toggleLoading}
            className="w-full"
          >
            {toggleLoading ? (
              <ActionLoading label={isSuspended ? "Unsuspending" : "Suspending"} />
            ) : isSuspended ? (
              "Unsuspend"
            ) : (
              "Suspend"
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function UserMobileCard({
  apiUrl,
  user,
  canEditRoles,
  isSelected,
  onToggleSelected,
  onViewDetails,
  onUpdated,
  onError,
}: {
  apiUrl: string;
  user: AdminUserListItem;
  canEditRoles: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onViewDetails: (userId: string) => void;
  onUpdated: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState<AdminUserListItem["role"]>(user.role);
  const [savingRole, setSavingRole] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const roleChanged = role !== user.role;
  const isSuspended = Boolean(user.suspendedAt);

  const saveRole = async () => {
    if (!roleChanged || !canEditRoles) return;
    if (!confirmAction(`Change ${user.name ?? user.email ?? user.id}'s role from ${user.role} to ${role}?`)) {
      return;
    }

    setSavingRole(true);
    try {
      await updateUserRole(apiUrl, user.id, role);
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSavingRole(false);
    }
  };

  const toggleSuspension = async () => {
    if (
      !confirmAction(
        isSuspended
          ? `Unsuspend ${user.name ?? user.email ?? user.id}?`
          : `Suspend ${user.name ?? user.email ?? user.id}?`
      )
    ) {
      return;
    }

    setToggleLoading(true);
    try {
      if (isSuspended) {
        await unsuspendUser(apiUrl, user.id);
      } else {
        await suspendUser(apiUrl, user.id);
      }
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setToggleLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-4 md:hidden">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelected}
            aria-label={`Select ${user.name ?? user.email ?? user.id}`}
            className="mt-1 size-4 rounded border-border"
          />
          <div className="space-y-1">
            <p className="font-medium">{user.name ?? "Unnamed user"}</p>
            <p className="text-sm text-muted-foreground">{user.email ?? "No email"}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Role</p>
            <div className="mt-2">{canEditRoles ? (
              <Select value={role} onValueChange={(value) => setRole(value as AdminUserListItem["role"])}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <BadgePill variant={statusBadgeVariant(user.role)}>{user.role}</BadgePill>
            )}</div>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            <div className="mt-2">
              {user.suspendedAt ? <BadgePill variant="destructive">Suspended</BadgePill> : <BadgePill variant="secondary">Active</BadgePill>}
            </div>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tier</p>
            <p className="mt-2 text-sm font-medium">{user.tier ?? "—"}</p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
            <p className="mt-2 text-sm font-medium">{formatDate(user.createdAt)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="sm" variant="outline" onClick={() => onViewDetails(user.id)} className="w-full sm:w-auto">
            <Eye className="size-4" />
            Details
          </Button>
          {canEditRoles ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void saveRole()}
              disabled={!roleChanged || savingRole}
              className="w-full sm:w-auto"
            >
              {savingRole ? <ActionLoading label="Saving role" /> : "Update role"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={isSuspended ? "secondary" : "destructive"}
            onClick={() => void toggleSuspension()}
            disabled={toggleLoading}
            className="w-full sm:w-auto"
          >
            {toggleLoading ? (
              <ActionLoading label={isSuspended ? "Unsuspending" : "Suspending"} />
            ) : isSuspended ? (
              "Unsuspend"
            ) : (
              "Suspend"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserDetailsSheet({
  apiUrl,
  userId,
  open,
  onOpenChange,
}: {
  apiUrl: string;
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [user, setUser] = useState<AdminUserDetails | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !userId) {
      setUser(null);
      setLogs([]);
      setError("");
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const [userResponse, logsResponse] = await Promise.all([
          fetchAdminUserDetails(apiUrl, userId),
          fetchAuditLogs(apiUrl, { actor: userId, page: 1, limit: 10 }),
        ]);
        setUser(userResponse.user);
        setLogs(logsResponse.logs);
        setError("");
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [apiUrl, open, userId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>User details</SheetTitle>
          <SheetDescription>Profile, trial/subscription status, and recent admin activity.</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="mt-6 space-y-3">
            <div className="wa-skeleton h-16 w-full" />
            <div className="wa-skeleton h-32 w-full" />
            <div className="wa-skeleton h-48 w-full" />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : user ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border p-4">
              <p className="font-medium">{user.name ?? "Unnamed user"}</p>
              <p className="text-sm text-muted-foreground">{user.email ?? "No email"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <BadgePill variant={statusBadgeVariant(user.role)}>{user.role}</BadgePill>
                <BadgePill variant={user.suspendedAt ? "destructive" : "secondary"}>
                  {user.suspendedAt ? "Suspended" : "Active"}
                </BadgePill>
                <Badge variant="outline">Tier {user.tier ?? "—"}</Badge>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Created {formatDateTime(user.createdAt)} · Updated {formatDateTime(user.updatedAt)}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trial</p>
                {user.trial ? (
                  <div className="mt-2 space-y-1 text-sm">
                    <p>Phone: {user.trial.phoneNumber}</p>
                    <p>Started: {formatDateTime(user.trial.trialStartedAt)}</p>
                    <p>Ends: {formatDateTime(user.trial.trialEndsAt)}</p>
                    <BadgePill variant={user.trial.isActive ? "secondary" : "destructive"}>
                      {user.trial.isActive ? "Active" : "Expired"}
                    </BadgePill>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No trial record.</p>
                )}
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subscription</p>
                {user.subscription ? (
                  <div className="mt-2 space-y-1 text-sm">
                    <p>Plan: {user.subscription.plan}</p>
                    <p>Started: {formatDateTime(user.subscription.startedAt)}</p>
                    <p>Ends: {formatDateTime(user.subscription.endsAt)}</p>
                    <BadgePill variant={statusBadgeVariant(user.subscription.status)}>
                      {user.subscription.status}
                    </BadgePill>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No subscription record.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent audit activity (actor = this user)
              </p>
              {logs.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {logs.map((log) => (
                    <div key={log.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{log.action}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Target {log.targetType}: {log.targetId}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No recent audit entries for this user.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Choose a user to view details.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TrialMobileCard({ trial }: { trial: TrialUsageRecord }) {
  return (
    <div className="rounded-lg border p-4 md:hidden">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{trial.phoneNumber}</p>
          <BadgePill variant={trial.isExpired ? "destructive" : "secondary"}>
            {trial.isExpired ? "Expired" : "Active"}
          </BadgePill>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">User</p>
            <p className="mt-2 text-sm font-medium">{trial.user?.name ?? trial.user?.email ?? trial.userId ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {trial.user ? `${trial.user.role} · ${trial.user.id}` : "No linked user"}
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Trial ends</p>
            <p className="mt-2 text-sm font-medium">{formatDateTime(trial.trialEndsAt)}</p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
            <p className="mt-2 text-sm font-medium">{formatDateTime(trial.createdAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillingSubscriptionCard({
  apiUrl,
  subscription,
  canUpdateBilling,
  onUpdated,
  onError,
}: {
  apiUrl: string;
  subscription: SubscriptionResponse;
  canUpdateBilling: boolean;
  onUpdated: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState(subscription.status);
  const [saving, setSaving] = useState(false);
  const changed = status !== subscription.status;

  const save = async () => {
    if (!changed) return;
    if (
      !confirmAction(
        `Update subscription ${subscription.id} status from ${subscription.status} to ${status}?`
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      await updateSubscriptionStatus(apiUrl, subscription.id, status);
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{subscription.plan}</p>
            <BadgePill variant={statusBadgeVariant(subscription.status)}>{subscription.status}</BadgePill>
          </div>
          <p className="text-sm text-muted-foreground">
            User {subscription.userId} · Started {formatDate(subscription.startedAt)}
          </p>
          <p className="text-sm text-muted-foreground">
            Updated {formatDateTime(subscription.updatedAt)} · {subscription.trialUsed ? "Trial used" : "Trial not used"}
          </p>
        </div>
        <div className="flex flex-col gap-2 md:min-w-56">
          <Select value={status} onValueChange={setStatus} disabled={!canUpdateBilling}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {BILLING_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={() => void save()} disabled={!changed || saving || !canUpdateBilling}>
            {saving ? <ActionLoading label="Saving" /> : "Update status"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BillingInvoiceCard({
  apiUrl,
  invoice,
  onUpdated,
  onError,
}: {
  apiUrl: string;
  invoice: InvoiceResponse;
  onUpdated: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState(invoice.status);
  const [saving, setSaving] = useState(false);
  const changed = status !== invoice.status;

  const save = async () => {
    if (!changed) return;
    if (!confirmAction(`Update invoice ${invoice.id} status from ${invoice.status} to ${status}?`)) {
      return;
    }

    setSaving(true);
    try {
      await updateInvoiceStatus(apiUrl, invoice.id, status);
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{formatCurrency(invoice.amount, invoice.currency)}</p>
            <BadgePill variant={statusBadgeVariant(invoice.status)}>{invoice.status}</BadgePill>
          </div>
          <p className="text-sm text-muted-foreground">
            User {invoice.userId} · Period {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}
          </p>
          <p className="text-sm text-muted-foreground">
            Invoice {invoice.id} · Paid {formatDateTime(invoice.paidAt)}
          </p>
        </div>
        <div className="flex flex-col gap-2 md:min-w-56">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {BILLING_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={() => void save()} disabled={!changed || saving}>
            {saving ? <ActionLoading label="Saving" /> : "Update status"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function OverviewSection({ apiUrl }: PanelProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<(typeof AUTO_REFRESH_SECONDS_OPTIONS)[number]>(60);

  const load = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const [overviewData, healthData] = await Promise.all([
        fetchAdminOverview(apiUrl),
        fetchSystemHealth(apiUrl),
      ]);
      setOverview(overviewData);
      setHealth(healthData);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void load(false);
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(intervalId);
  }, [autoRefreshEnabled, autoRefreshSeconds, apiUrl]);

  if (loading) return <LoadingState lines={3} />;
  if (error || !overview || !health) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Overview"
        title="Admin operations at a glance"
        description="Live admin status, platform health, and revenue/usage snapshots."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} />
              <span className="text-xs text-muted-foreground">Auto-refresh</span>
            </div>
            <Select
              value={String(autoRefreshSeconds)}
              onValueChange={(value) => setAutoRefreshSeconds(Number(value) as (typeof AUTO_REFRESH_SECONDS_OPTIONS)[number])}
              disabled={!autoRefreshEnabled}
            >
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_REFRESH_SECONDS_OPTIONS.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void load()} className="gap-2">
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <OverviewMetricGrid overview={overview} health={health} />

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="System health" description="Current application and infrastructure posture.">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <BadgePill variant={statusBadgeVariant(health.status)}>{health.status.toUpperCase()}</BadgePill>
              <Badge variant="outline" className="gap-1.5">
                <PanelTopOpen className="size-3.5" />
                Updated {formatDateTime(health.generatedAt)}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">App uptime</p>
                <p className="mt-2 text-2xl font-semibold">{formatDuration(health.app.uptimeSeconds)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Memory RSS {health.app.memoryUsageMb.rss.toFixed(1)} MB · Heap {health.app.memoryUsageMb.heapUsed.toFixed(1)} MB
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Database</p>
                <p className="mt-2 text-2xl font-semibold">{health.db.status.toUpperCase()}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Latency {health.db.latencyMs ?? "—"} ms · Users counted {health.db.totalUsers ?? "—"}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Operational highlights"
          description="The highest-signal indicators from the admin overview."
          badge="Live"
        >
          <div className="space-y-4">
            {[
              {
                label: "Messages sent in the last 24h",
                value: overview.sentMessages.sentLast24h.toLocaleString(),
                detail: "Delivery throughput over the last day",
              },
              {
                label: "Messages sent in the last 7d",
                value: overview.sentMessages.sentLast7d.toLocaleString(),
                detail: "Rolling weekly send volume",
              },
              {
                label: "WhatsApp active sessions",
                value: overview.activeWaConnections.toLocaleString(),
                detail: "Healthy active connections across tenants",
              },
              {
                label: "Invoices tracked",
                value: overview.revenue.totalInvoices.toLocaleString(),
                detail: "Billing records available in the admin surface",
              },
            ].map((item) => (
              <div key={item.label} className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function UsersSection({ apiUrl, canEditRoles = false }: PanelProps & { canEditRoles?: boolean }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkRole, setBulkRole] = useState<AdminUserListItem["role"]>("user");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<(typeof AUTO_REFRESH_SECONDS_OPTIONS)[number]>(60);

  const offset = (page - 1) * USER_PAGE_SIZE;

  const load = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const data = await fetchAdminUsers(apiUrl, { q: query || undefined, limit: USER_PAGE_SIZE, offset });
      setResult(data);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl, query, page]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void load(false);
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(intervalId);
  }, [autoRefreshEnabled, autoRefreshSeconds, apiUrl, query, page]);

  useEffect(() => {
    if (!result) {
      return;
    }
    const pageUserIds = new Set(result.users.map((user) => user.id));
    setSelectedUserIds((previous) => previous.filter((id) => pageUserIds.has(id)));
  }, [result]);

  const roleCounts = useMemo(() => {
    const users = result?.users ?? [];
    return users.reduce(
      (acc, user) => {
        acc[user.role] += 1;
        if (user.suspendedAt) acc.suspended += 1;
        return acc;
      },
      { user: 0, admin: 0, suspended: 0 },
    );
  }, [result]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / USER_PAGE_SIZE)) : 1;
  const allSelectedOnPage = Boolean(
    result && result.users.length > 0 && result.users.every((user) => selectedUserIds.includes(user.id))
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQuery(draftQuery.trim());
  };

  const toggleSelection = (userId: string) => {
    setSelectedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const toggleSelectAllOnPage = () => {
    if (!result || result.users.length === 0) {
      return;
    }
    if (allSelectedOnPage) {
      setSelectedUserIds([]);
      return;
    }
    setSelectedUserIds(result.users.map((user) => user.id));
  };

  const openUserDetails = (userId: string) => {
    setDetailsUserId(userId);
    setDetailsOpen(true);
  };

  const runBulkSuspension = async (suspended: boolean) => {
    if (selectedUserIds.length === 0) return;
    if (!confirmAction(`${suspended ? "Suspend" : "Unsuspend"} ${selectedUserIds.length} selected users?`)) {
      return;
    }

    setBulkLoading(true);
    try {
      await bulkSetUserSuspension(apiUrl, selectedUserIds, suspended);
      setSelectedUserIds([]);
      await load(false);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const runBulkRoleUpdate = async () => {
    if (selectedUserIds.length === 0) return;
    if (!confirmAction(`Set role to ${bulkRole} for ${selectedUserIds.length} selected users?`)) {
      return;
    }

    setBulkLoading(true);
    try {
      await bulkUpdateUserRole(apiUrl, selectedUserIds, bulkRole);
      setSelectedUserIds([]);
      await load(false);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const exportUsers = async (format: "csv" | "json") => {
    setExportLoading(true);
    try {
      const collected: AdminUserListItem[] = [];
      let nextOffset = 0;
      while (true) {
        const data = await fetchAdminUsers(apiUrl, { q: query || undefined, limit: 100, offset: nextOffset });
        collected.push(...data.users);
        nextOffset += data.users.length;
        if (nextOffset >= data.total || data.users.length === 0) {
          break;
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      if (format === "json") {
        downloadFile(`admin-users-${timestamp}.json`, JSON.stringify(collected, null, 2), "application/json");
      } else {
        const header = ["id", "name", "email", "role", "tier", "status", "createdAt", "updatedAt"];
        const rows = collected.map((user) =>
          [
            toCsvValue(user.id),
            toCsvValue(user.name),
            toCsvValue(user.email),
            toCsvValue(user.role),
            toCsvValue(user.tier),
            toCsvValue(user.suspendedAt ? "suspended" : "active"),
            toCsvValue(user.createdAt),
            toCsvValue(user.updatedAt),
          ].join(",")
        );
        downloadFile(`admin-users-${timestamp}.csv`, [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
      }
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExportLoading(false);
    }
  };

  if (loading) return <LoadingState lines={4} />;
  if (error || !result) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Users"
        title="Accounts, roles, and access"
        description="Browse the user directory, review role distribution, and inspect suspended accounts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} />
              <span className="text-xs text-muted-foreground">Auto-refresh</span>
            </div>
            <Select
              value={String(autoRefreshSeconds)}
              onValueChange={(value) => setAutoRefreshSeconds(Number(value) as (typeof AUTO_REFRESH_SECONDS_OPTIONS)[number])}
              disabled={!autoRefreshEnabled}
            >
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_REFRESH_SECONDS_OPTIONS.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void load()} className="gap-2">
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Users on page"
          value={result.users.length.toLocaleString()}
          detail={query ? `Filter applied: ${query}` : "Current page results"}
          icon={Users}
        />
        <MetricCard
          label="Total matching"
          value={result.total.toLocaleString()}
          detail={`Page ${page} of ${totalPages}`}
          icon={SquareStack}
        />
        <MetricCard label="Admins" value={roleCounts.admin.toLocaleString()} detail="Users with admin access" icon={UserCog} />

        <MetricCard
          label="Suspended"
          value={roleCounts.suspended.toLocaleString()}
          detail="Accounts currently suspended"
          icon={XCircle}
        />
      </div>

      <SectionCard title="User directory" description="Search by name, email, or organization-level identifier.">
        <form onSubmit={submit} className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              className="pl-10"
              placeholder="Search users"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="gap-2 sm:w-auto">
              <Filter className="size-4" />
              Search
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftQuery("");
                setQuery("");
                setPage(1);
              }}
              className="sm:w-auto"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void exportUsers("csv")}
              disabled={exportLoading}
              className="gap-2 sm:w-auto"
            >
              <Download className="size-4" />
              CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void exportUsers("json")}
              disabled={exportLoading}
              className="gap-2 sm:w-auto"
            >
              <Download className="size-4" />
              JSON
            </Button>
          </div>
        </form>

        <div className="mt-6 space-y-4">
          {selectedUserIds.length > 0 ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm">
                  <span className="font-semibold">{selectedUserIds.length}</span> users selected
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={bulkRole} onValueChange={(value) => setBulkRole(value as AdminUserListItem["role"])}>
                    <SelectTrigger className="h-9 w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => void runBulkRoleUpdate()} disabled={bulkLoading}>
                    Apply role
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void runBulkSuspension(true)} disabled={bulkLoading}>
                    Suspend
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void runBulkSuspension(false)} disabled={bulkLoading}>
                    Unsuspend
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {result.users.length === 0 ? (
            <EmptyState
              title="No users found"
              description="No accounts matched the current search. Clear the filter or try another query."
              icon={Users}
            />
          ) : (
            <>
              <ResponsiveTableShell>
                <table className="hidden min-w-full divide-y divide-border text-sm md:table">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">
                        <input
                          type="checkbox"
                          checked={allSelectedOnPage}
                          onChange={toggleSelectAllOnPage}
                          aria-label="Select all users on page"
                          className="size-4 rounded border-border"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Tier</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.users.map((user: AdminUserListItem) => (
                      <UserRowCard
                        key={user.id}
                        apiUrl={apiUrl}
                        user={user}
                        canEditRoles={canEditRoles}
                        isSelected={selectedUserIds.includes(user.id)}
                        onToggleSelected={() => toggleSelection(user.id)}
                        onViewDetails={openUserDetails}
                        onUpdated={() => load(false)}
                        onError={setError}
                      />
                    ))}
                  </tbody>
                </table>
              </ResponsiveTableShell>
              <div className="space-y-3 md:hidden">
                {result.users.map((user) => (
                  <UserMobileCard
                    key={user.id}
                    apiUrl={apiUrl}
                    user={user}
                    canEditRoles={canEditRoles}
                    isSelected={selectedUserIds.includes(user.id)}
                    onToggleSelected={() => toggleSelection(user.id)}
                    onViewDetails={openUserDetails}
                    onUpdated={() => load(false)}
                    onError={setError}
                  />
                ))}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {result.total === 0 ? 0 : offset + 1} to {Math.min(offset + result.users.length, result.total)} of{" "}
                  {result.total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="size-4" />
                    Previous
                  </Button>
                  <Badge variant="outline">
                    Page {page} / {totalPages}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SectionCard>

      <UserDetailsSheet
        apiUrl={apiUrl}
        userId={detailsUserId}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) {
            setDetailsUserId(null);
          }
        }}
      />
    </div>
  );
}

export function WhatsappOpsSection({ apiUrl }: PanelProps) {
  const [ops, setOps] = useState<WhatsappOpsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setOps(await fetchWhatsappOps(apiUrl));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  if (loading) return <LoadingState lines={3} />;
  if (error || !ops) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="WhatsApp Ops"
        title="Connections and delivery health"
        description="Track live connection states and recent connection failures across the platform."
        actions={
          <Button variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total", value: ops.counts.total, icon: SquareStack },
          { label: "Connected", value: ops.counts.connected, icon: Wifi },
          { label: "Waiting", value: ops.counts.waiting, icon: Loader2 },
          { label: "Disconnected", value: ops.counts.disconnected, icon: WifiOff },
          { label: "Idle", value: ops.counts.idle, icon: PanelTopOpen },
        ].map(({ label, value, icon: Icon }) => (
          <MetricCard
            key={String(label)}
            label={String(label)}
            value={Number(value).toLocaleString()}
            detail="Current live connection count"
            icon={Icon as ComponentType<{ className?: string }>}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Connection breakdown" description="Live WA connection status by operational state.">
          <div className="space-y-3">
            {[
              { label: "Connected", value: ops.counts.connected, icon: Wifi, variant: "default" as const },
              { label: "Waiting for QR", value: ops.counts.waiting, icon: Loader2, variant: "secondary" as const },
              { label: "Disconnected", value: ops.counts.disconnected, icon: WifiOff, variant: "destructive" as const },
              { label: "Idle", value: ops.counts.idle, icon: PanelTopOpen, variant: "outline" as const },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-muted p-2">
                    <item.icon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">Current live state</p>
                  </div>
                </div>
                <BadgePill variant={item.variant}>{item.value.toLocaleString()}</BadgePill>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Recent connection errors" description="Most recent failure signals captured by ops monitoring.">
          {ops.recentConnectionErrors.length === 0 ? (
            <EmptyState
              title="No recent connection errors"
              description="This indicates the platform has not seen recent WhatsApp connection issues."
              icon={CheckCircle2}
            />
          ) : (
            <div className="space-y-3">
              {ops.recentConnectionErrors.map((item) => (
                <div key={`${item.userId}-${item.lastErrorAt ?? item.lastError}`} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.userId}</p>
                        <BadgePill variant={statusBadgeVariant(item.status)}>{item.status}</BadgePill>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.lastError}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{formatDateTime(item.lastErrorAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export function TrialsSection({ apiUrl }: PanelProps) {
  const [draftPhone, setDraftPhone] = useState("");
  const [draftUser, setDraftUser] = useState("");
  const [phone, setPhone] = useState("");
  const [user, setUser] = useState("");
  const [trials, setTrials] = useState<TrialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchTrials(apiUrl, { page: 1, limit: 25, phone: phone || undefined, user: user || undefined });
      setTrials(data);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl, phone, user]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPhone(draftPhone.trim());
    setUser(draftUser.trim());
  };

  if (loading) return <LoadingState lines={4} />;
  if (error || !trials) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Trials"
        title="Trial lifecycle monitoring"
        description="Track trial usage by phone or user, and quickly spot expirations and active trials."
        actions={
          <Button variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Loaded records"
          value={trials.trials.length.toLocaleString()}
          detail={`Page ${trials.pagination.page} of ${trials.pagination.totalPages}`}
          icon={CalendarRange}
        />
        <MetricCard
          label="Expired trials"
          value={trials.trials.filter((trial) => trial.isExpired).length.toLocaleString()}
          detail="Trials that have passed their end date"
          icon={XCircle}
        />
        <MetricCard
          label="Active trials"
          value={trials.trials.filter((trial) => !trial.isExpired).length.toLocaleString()}
          detail="Trials still within their active window"
          icon={CheckCircle2}
        />
      </div>

      <SectionCard title="Trial search" description="Filter the list by phone number or user identifier.">
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <Input value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} placeholder="Phone number" />
          <Input value={draftUser} onChange={(e) => setDraftUser(e.target.value)} placeholder="User ID or name" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="gap-2 sm:w-auto">
              <Search className="size-4" />
              Filter
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftPhone("");
                setDraftUser("");
                setPhone("");
                setUser("");
              }}
              className="sm:w-auto"
            >
              Clear
            </Button>
          </div>
        </form>

        <div className="mt-6 space-y-4">
          {trials.trials.length === 0 ? (
            <EmptyState
              title="No trials found"
              description="There are no matching trial records for the current filter set."
              icon={CalendarRange}
            />
          ) : (
            <>
              <ResponsiveTableShell>
                <table className="hidden min-w-full divide-y divide-border text-sm md:table">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Trial ends</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {trials.trials.map((trial: TrialUsageRecord) => (
                      <tr key={trial.id}>
                        <td className="px-4 py-4 font-medium">{trial.phoneNumber}</td>
                        <td className="px-4 py-4">
                          <div className="space-y-1">
                            <p>{trial.user?.name ?? trial.user?.email ?? trial.userId ?? "—"}</p>
                            <p className="text-muted-foreground">
                              {trial.user ? `${trial.user.role} · ${trial.user.id}` : "No linked user"}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <BadgePill variant={trial.isExpired ? "destructive" : "secondary"}>
                            {trial.isExpired ? "Expired" : "Active"}
                          </BadgePill>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{formatDateTime(trial.trialEndsAt)}</td>
                        <td className="px-4 py-4 text-muted-foreground">{formatDateTime(trial.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTableShell>
              <div className="space-y-3 md:hidden">
                {trials.trials.map((trial) => (
                  <TrialMobileCard key={trial.id} trial={trial} />
                ))}
              </div>
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

export function BillingSection({ apiUrl, canUpdateBilling = true }: PanelProps & { canUpdateBilling?: boolean }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [subscriptionData, invoiceData] = await Promise.all([
        fetchBillingSubscriptions(apiUrl),
        fetchBillingInvoices(apiUrl),
      ]);
      setSubscriptions(subscriptionData.subscriptions);
      setInvoices(invoiceData.invoices);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  const invoiceCurrency = invoices[0]?.currency ?? null;
  const revenue = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);

  if (loading) return <LoadingState lines={3} />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Billing"
        title="Plans, invoices, and payment posture"
        description="Review subscription state and invoice history from the billing admin surface."
        actions={
          <Button variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Subscriptions"
          value={subscriptions.length.toLocaleString()}
          detail="All active and inactive subscription records"
          icon={CreditCard}
        />
        <MetricCard
          label="Invoices"
          value={invoices.length.toLocaleString()}
          detail="Invoice history available in the admin API"
          icon={FileClock}
        />
        <MetricCard
          label="Revenue tracked"
          value={formatCurrency(revenue, invoiceCurrency)}
          detail="Sum of invoice amounts"
          icon={ArrowUpRight}
        />
        <MetricCard
          label="Paid invoices"
          value={invoices.filter((invoice) => invoice.status === "paid").length.toLocaleString()}
          detail="Invoices marked as paid"
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Subscriptions" description="Current plan assignment and billing status.">
          {subscriptions.length === 0 ? (
            <EmptyState
              title="No subscriptions found"
              description="There are no subscription records in the current dataset."
              icon={CreditCard}
            />
          ) : (
            <div className="space-y-3">
              {subscriptions.map((subscription) => (
                <BillingSubscriptionCard
                  key={subscription.id}
                  apiUrl={apiUrl}
                  subscription={subscription}
                  canUpdateBilling={canUpdateBilling}
                  onUpdated={load}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Invoices" description="Payment and invoice timeline.">
          {invoices.length === 0 ? (
            <EmptyState
              title="No invoices found"
              description="No invoice rows are currently returned from the billing API."
              icon={FileClock}
            />
          ) : (
            <div className="space-y-3">
              {invoices.slice(0, 12).map((invoice) => (
                <BillingInvoiceCard
                  key={invoice.id}
                  apiUrl={apiUrl}
                  invoice={invoice}
                  onUpdated={load}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export function SecuritySection({ apiUrl }: PanelProps) {
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [sessionsData, eventsData] = await Promise.all([
        fetchSecuritySessions(apiUrl),
        fetchSecurityEvents(apiUrl),
      ]);
      setSessions(sessionsData.sessions);
      setEvents(eventsData.events);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    if (!confirmAction(`Revoke session ${sessionId}? This will sign the user out immediately.`)) {
      return;
    }

    setRevokingId(sessionId);
    try {
      await revokeSecuritySession(apiUrl, sessionId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRevokingId(null);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  if (loading) return <LoadingState lines={4} />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Security"
        title="Sessions and security events"
        description="Inspect logged-in sessions, operational alerts, and privileged security events."
        actions={
          <Button variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Sessions"
          value={sessions.length.toLocaleString()}
          detail="Active session rows in the admin API"
          icon={PanelTopOpen}
        />
        <MetricCard
          label="Security events"
          value={events.length.toLocaleString()}
          detail="Recent security events and alerts"
          icon={ShieldAlert}
        />
        <MetricCard
          label="High severity"
          value={events.filter((event) => event.severity === "high" || event.severity === "critical").length.toLocaleString()}
          detail="Escalated events needing attention"
          icon={XCircle}
        />
        <MetricCard
          label="Revocable sessions"
          value={sessions.filter((session) => session.userId).length.toLocaleString()}
          detail="Sessions with a user association"
          icon={UserCog}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Sessions" description="Current session inventory. Use revoke to invalidate a session.">
          {sessions.length === 0 ? (
            <EmptyState
              title="No sessions found"
              description="There are currently no session rows available from the security API."
              icon={PanelTopOpen}
            />
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{session.user?.name ?? session.user?.email ?? session.userId}</p>
                        <BadgePill variant={statusBadgeVariant(session.user?.role ?? "unknown")}>
                          {session.user?.role ?? "unknown"}
                        </BadgePill>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Expires {formatDateTime(session.expiresAt)} · Created {formatDateTime(session.createdAt)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {session.ipAddress ?? "No IP"} · {session.userAgent ?? "No user agent"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void revokeSession(session.id)}
                      disabled={revokingId === session.id}
                      className="w-full gap-2 md:w-auto"
                    >
                      {revokingId === session.id ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Security events" description="Recent alerts and security-related records.">
          {events.length === 0 ? (
            <EmptyState
              title="No security events"
              description="The security event feed is currently empty."
              icon={ShieldAlert}
            />
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{event.type}</p>
                        <BadgePill variant={statusBadgeVariant(event.severity)}>{event.severity}</BadgePill>
                      </div>
                      <p className="text-sm text-muted-foreground">{event.detail ?? "No detail provided"}</p>
                      <p className="text-sm text-muted-foreground">
                        {event.user?.name ?? event.user?.email ?? event.userId ?? "System"} · {event.ipAddress ?? "Unknown IP"}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export function AuditLogsSection({ apiUrl }: PanelProps) {
  const [draftActor, setDraftActor] = useState("");
  const [draftAction, setDraftAction] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLogs(apiUrl, {
        actor: actor || undefined,
        action: action || undefined,
        page: 1,
        limit: 50,
      });
      setLogs(data.logs);
      setTotal(data.total);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl, actor, action]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setActor(draftActor.trim());
    setAction(draftAction.trim());
  };

  if (loading) return <LoadingState lines={4} />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Audit Logs"
        title="Admin action trail"
        description="Review administrative actions, targets, and metadata from the audit log feed."
        actions={
          <Button variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Events loaded" value={logs.length.toLocaleString()} detail={`Total matching records: ${total.toLocaleString()}`} icon={FileClock} />
        <MetricCard label="Unique actions" value={new Set(logs.map((log) => log.action)).size.toLocaleString()} detail="Distinct actions in the current page" icon={Filter} />
        <MetricCard label="Actors" value={new Set(logs.map((log) => log.actorUserId)).size.toLocaleString()} detail="Unique users with recorded actions" icon={UserCog} />
      </div>

      <SectionCard title="Filter logs" description="Filter by actor user ID or action name.">
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <Input value={draftActor} onChange={(e) => setDraftActor(e.target.value)} placeholder="Actor user ID" />
          <Input value={draftAction} onChange={(e) => setDraftAction(e.target.value)} placeholder="Action name" />
          <div className="flex gap-2">
            <Button type="submit" className="gap-2">
              <Search className="size-4" />
              Apply
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftActor("");
                setDraftAction("");
                setActor("");
                setAction("");
              }}
            >
              Clear
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Recent audit entries" description="Chronological review of administrative changes.">
        {logs.length === 0 ? (
          <EmptyState
            title="No audit logs found"
            description="There are no matching audit records for the selected filters."
            icon={FileClock}
          />
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{log.action}</p>
                      <BadgePill variant={statusBadgeVariant(log.targetType)}>{log.targetType}</BadgePill>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Target {log.targetId} · Actor {log.actor?.name ?? log.actor?.email ?? log.actorUserId}
                    </p>
                    {log.metadata ? (
                      <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">No metadata recorded.</p>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{formatDateTime(log.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
