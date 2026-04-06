import { useState, useEffect } from "react";
import { Send, XCircle, Clock, Bot, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import { fetchJson, ApiResponseError } from "@/lib/api-utils";
import { cn } from "@/lib/utils";

interface Stats {
  totalSent: number;
  totalFailed: number;
  sentToday: number;
  failedToday: number;
  dailyActivity: { date: string; sent: number; failed: number }[];
  scheduledPending: number;
  autoReplyRules: number;
  templates: number;
  connectionStatus: string;
}

const chartConfig = {
  sent: { label: "Sent", color: "var(--primary)" },
  failed: { label: "Failed", color: "var(--destructive)" },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatusIndicator({ status }: { status: string }) {
  const config: Record<string, { label: string; dotClass: string; bgClass: string }> = {
    connected: { label: "Connected", dotClass: "wa-status-online", bgClass: "bg-primary/10 text-primary" },
    waiting_qr: { label: "Awaiting QR", dotClass: "wa-status-warning", bgClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    disconnected: { label: "Disconnected", dotClass: "wa-status-error", bgClass: "bg-destructive/10 text-destructive" },
    idle: { label: "Idle", dotClass: "wa-status-offline", bgClass: "bg-muted text-muted-foreground" },
  };
  const curr = config[status] ?? config.idle;
  
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium", curr.bgClass)}>
      <span className={cn("wa-status-dot", curr.dotClass)} />
      {curr.label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  subValue,
  icon: Icon,
  trend,
  accentClass,
}: {
  label: string;
  value: number;
  subValue: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  accentClass: string;
}) {
  return (
    <div className="wa-card wa-animate-in p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value.toLocaleString()}</p>
          <div className="mt-1 flex items-center gap-1.5">
            {trend === "up" && <TrendingUp className="size-3 text-primary" />}
            {trend === "down" && <TrendingDown className="size-3 text-destructive" />}
            <span className="text-xs text-muted-foreground">{subValue}</span>
          </div>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", accentClass)}>
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="wa-card p-4">
      <div className="wa-skeleton mb-3 h-3 w-20" />
      <div className="wa-skeleton mb-2 h-7 w-24" />
      <div className="wa-skeleton h-3 w-16" />
    </div>
  );
}

export default function OverviewPage({ apiUrl }: { apiUrl: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    try {
      const data = await fetchJson<Stats>(`${apiUrl}/api/whatsapp/stats`, {
        credentials: "include"
      });
      setStats(data);
      setError("");
    } catch (e) {
      if (e instanceof ApiResponseError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load stats");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="wa-skeleton h-14 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="wa-skeleton h-72 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="wa-card wa-animate-in border-l-4 border-destructive p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-5 text-destructive" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Unable to load dashboard</h3>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => { setLoading(true); fetchStats(); }}
              className="mt-3 text-sm font-medium text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const chartData = stats.dailyActivity.map((d) => ({
    date: formatDate(d.date),
    sent: d.sent,
    failed: d.failed,
  }));

  const metrics = [
    {
      label: "Messages Sent",
      value: stats.totalSent,
      subValue: `${stats.sentToday} today`,
      icon: Send,
      trend: stats.sentToday > 0 ? "up" as const : "neutral" as const,
      accentClass: "bg-primary/15 text-primary",
    },
    {
      label: "Failed",
      value: stats.totalFailed,
      subValue: `${stats.failedToday} today`,
      icon: XCircle,
      trend: stats.failedToday > 0 ? "down" as const : "neutral" as const,
      accentClass: "bg-destructive/15 text-destructive",
    },
    {
      label: "Scheduled",
      value: stats.scheduledPending,
      subValue: "Pending messages",
      icon: Clock,
      accentClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    },
    {
      label: "Automations",
      value: stats.autoReplyRules,
      subValue: `${stats.templates} templates`,
      icon: Bot,
      accentClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="wa-card wa-animate-in flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Live Performance</h2>
          <p className="text-sm text-muted-foreground">Real-time messaging activity</p>
        </div>
        <StatusIndicator status={stats.connectionStatus} />
      </div>

      {/* Metrics grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      {/* Chart */}
      <div className="wa-card wa-animate-in overflow-hidden">
        <div className="border-b px-5 py-4 dark:border-[#233138]">
          <h3 className="text-sm font-semibold text-foreground">7-Day Activity</h3>
          <p className="text-xs text-muted-foreground">Messages sent vs failed over the past week</p>
        </div>
        <div className="p-4">
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--destructive)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={40}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="sent"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#sentGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stroke="var(--destructive)"
                  strokeWidth={2}
                  fill="url(#failedGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
        
        {/* Legend */}
        <div className="flex items-center justify-center gap-6 border-t px-4 py-3 dark:border-[#233138]">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">Sent</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-destructive" />
            <span className="text-xs text-muted-foreground">Failed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
