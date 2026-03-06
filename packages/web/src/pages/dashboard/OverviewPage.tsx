import { useState, useEffect } from "react";
import { Send, XCircle, Clock, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  CartesianGrid,
} from "recharts";

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
  sent: { label: "Sent", color: "hsl(var(--chart-1))" },
  failed: { label: "Failed", color: "hsl(var(--chart-2))" },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; dot: string }> = {
    connected: { label: "Connected", dot: "bg-green-500" },
    waiting_qr: { label: "Waiting for QR", dot: "bg-yellow-500" },
    disconnected: { label: "Disconnected", dot: "bg-red-500" },
    idle: { label: "Idle", dot: "bg-gray-400" },
  };
  const { label, dot } = map[status] ?? { label: status, dot: "bg-gray-400" };
  return (
    <Badge variant="outline" className="gap-1.5 px-2 py-1">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </Badge>
  );
}

export default function OverviewPage({ apiUrl }: { apiUrl: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp/stats`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Stats = await res.json();
      setStats(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
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
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load stats: {error}
      </div>
    );
  }

  if (!stats) return null;

  const chartData = stats.dailyActivity.map((d) => ({
    date: formatDate(d.date),
    sent: d.sent,
    failed: d.failed,
  }));

  const statCards = [
    {
      title: "Total Sent",
      value: stats.totalSent,
      sub: `${stats.sentToday} today`,
      icon: Send,
      iconClass: "text-green-500",
    },
    {
      title: "Failed",
      value: stats.totalFailed,
      sub: `${stats.failedToday} today`,
      icon: XCircle,
      iconClass: "text-red-500",
    },
    {
      title: "Scheduled",
      value: stats.scheduledPending,
      sub: "pending messages",
      icon: Clock,
      iconClass: "text-blue-500",
    },
    {
      title: "Auto-Reply Rules",
      value: stats.autoReplyRules,
      sub: `${stats.templates} templates saved`,
      icon: Bot,
      iconClass: "text-purple-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Dashboard Overview</h2>
        <StatusBadge status={stats.connectionStatus} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ title, value, sub, icon: Icon, iconClass }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <Icon className={`size-4 ${iconClass}`} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Daily Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="sent"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#colorSent)"
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="url(#colorFailed)"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
