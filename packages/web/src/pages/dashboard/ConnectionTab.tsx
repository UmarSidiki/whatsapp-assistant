import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/lib/api-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type WAStatus = "idle" | "waiting_qr" | "connected" | "disconnected";

const STATUS_LABELS: Record<WAStatus, string> = {
  idle: "Not connected",
  waiting_qr: "Waiting for scan",
  connected: "Connected",
  disconnected: "Disconnected",
};
const STATUS_VARIANTS: Record<WAStatus, "default" | "secondary" | "destructive" | "outline"> = {
  idle: "secondary",
  waiting_qr: "outline",
  connected: "default",
  disconnected: "destructive",
};

export function ConnectionTab({ apiUrl }: { apiUrl: string }) {
  const [status, setStatus] = useState<WAStatus>("idle");
  const [qr, setQr] = useState<string | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [quickPhone, setQuickPhone] = useState("");
  const [quickMessage, setQuickMessage] = useState("");
  const [sendFeedback, setSendFeedback] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailuresRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollFailuresRef.current = 0;
  }, []);

  const startPolling = useCallback((url: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const data = await fetchJson<{ status: WAStatus; qr?: string }>(
          `${url}/api/whatsapp/status`, 
          { credentials: "include" }
        );
        pollFailuresRef.current = 0;
        setStatus(data.status);
        setQr(data.qr);
        if (data.status === "connected" || data.status === "idle" || data.status === "disconnected") {
          stopPolling();
        }
      } catch {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= 5) {
          stopPolling();
        }
      }
    }, 3000);
  }, [stopPolling]);

  useEffect(() => {
    const syncStatus = async () => {
      try {
        const data = await fetchJson<{ status: WAStatus; qr?: string }>(
          `${apiUrl}/api/whatsapp/status`, 
          { credentials: "include" }
        );
        setStatus(data.status);
        setQr(data.qr);
        if (data.status === "waiting_qr") {
          startPolling(apiUrl);
        }
      } catch {
        // Keep local defaults if initial status request fails.
      }
    };

    syncStatus();
    return stopPolling;
  }, [apiUrl, startPolling, stopPolling]);

  const handleConnect = async () => {
    try {
      setConnecting(true);
      const res = await fetch(`${apiUrl}/api/whatsapp/init`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        setStatus("disconnected");
        return;
      }
      setStatus("waiting_qr");
      startPolling(apiUrl);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    stopPolling();
    await fetch(`${apiUrl}/api/whatsapp/disconnect`, { method: "POST", credentials: "include" });
    setStatus("disconnected");
    setQr(undefined);
  };

  const handleQuickSend = async () => {
    setSendFeedback("");
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: quickPhone, message: quickMessage }),
      });
      setSendFeedback(res.ok ? "✓ Message sent" : "✗ Failed to send");
    } catch {
      setSendFeedback("✗ Network error");
    }
    setTimeout(() => setSendFeedback(""), 3000);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>WhatsApp Status</CardTitle>
            <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
          </div>
          <CardDescription>
            {status === "idle" && "Connect to start using WhatsApp tools."}
            {status === "waiting_qr" && "Open WhatsApp → Linked Devices → Scan QR."}
            {status === "connected" && "Your WhatsApp session is active."}
            {status === "disconnected" && "Session ended. Reconnect below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === "waiting_qr" && qr && (
            <div className="rounded-lg border bg-white p-4">
              <QRCode value={qr} size={220} />
            </div>
          )}
          {status === "waiting_qr" && !qr && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Generating QR code…
            </div>
          )}
          {status === "connected" && (
            <div className="flex items-center gap-2 py-4 font-medium text-green-600 dark:text-green-400">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              WhatsApp Connected
            </div>
          )}
          <div className="flex gap-2">
            {(status === "idle" || status === "disconnected") && (
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect WhatsApp"}
              </Button>
            )}
            {(status === "waiting_qr" || status === "connected") && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="destructive" onClick={handleDisconnect}>Disconnect</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">This will stop your WhatsApp bot and require you to scan the QR code again to reconnect.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Send</CardTitle>
          <CardDescription>Send a single message instantly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="q-phone">Phone number</Label>
            <Input id="q-phone" placeholder="+1234567890" value={quickPhone} onChange={e => setQuickPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="q-msg">Message</Label>
            <Textarea id="q-msg" placeholder="Type your message…" rows={4} value={quickMessage} onChange={e => setQuickMessage(e.target.value)} />
          </div>
          {sendFeedback && <p className={`text-sm ${sendFeedback.startsWith("✓") ? "text-green-600" : "text-destructive"}`}>{sendFeedback}</p>}
          <Button className="w-full" onClick={handleQuickSend} disabled={!quickPhone || !quickMessage || status !== "connected"}>
            Send Message
          </Button>
          {status !== "connected" && (
            <p className="text-xs text-muted-foreground text-center">Connect WhatsApp first to enable sending.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
