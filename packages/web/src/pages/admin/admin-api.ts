import { ApiResponseError, fetchJson } from "@/lib/api-utils";

export type AdminOverview = {
  totalUsers: number;
  activeWaConnections: number;
  trialRecordsCount: number;
  sentMessages: {
    sentLast24h: number;
    sentLast7d: number;
  };
  revenue: {
    totalInvoices: number;
    totalInvoiceAmount: number;
    activeSubscriptions: number;
    currency: string | null;
  };
  generatedAt: string;
};

export type SystemHealth = {
  status: "ok" | "degraded";
  generatedAt: string;
  app: {
    uptimeSeconds: number;
    memoryUsageMb: {
      rss: number;
      heapUsed: number;
    };
  };
  db: {
    status: "ok" | "down";
    latencyMs: number | null;
    totalUsers: number | null;
  };
  whatsapp: {
    activeConnections: number;
    connectedSessions: number;
  };
};

export type AdminUserListItem = {
  id: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  tier: string | null;
  suspendedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminUsersResponse = {
  users: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminUserDetails = AdminUserListItem & {
  trial: {
    id: string;
    phoneNumber: string;
    userId: string | null;
    trialStartedAt: string;
    trialEndsAt: string;
    createdAt: string;
    isActive: boolean;
  } | null;
  subscription: {
    id: string;
    plan: string;
    status: string;
    startedAt: string;
    endsAt: string | null;
    trialUsed: boolean;
    updatedAt: string;
  } | null;
};

export type TrialUsageRecord = {
  id: string;
  phoneNumber: string;
  userId: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: "user" | "admin";
  } | null;
  trialStartedAt: string;
  trialEndsAt: string;
  createdAt: string;
  isExpired: boolean;
};

export type TrialsResponse = {
  trials: TrialUsageRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    phone?: string;
    user?: string;
  };
};

export type WhatsappOpsSnapshot = {
  generatedAt: string;
  counts: {
    total: number;
    connected: number;
    waiting: number;
    disconnected: number;
    idle: number;
  };
  recentConnectionErrors: Array<{
    userId: string;
    status: string;
    lastError: string;
    lastErrorAt: string | null;
  }>;
};

export type SubscriptionResponse = {
  id: string;
  userId: string;
  plan: string;
  status: string;
  startedAt: string;
  endsAt: string | null;
  trialUsed: boolean;
  updatedAt: string;
};

export type InvoiceResponse = {
  id: string;
  userId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
};

export type SecuritySession = {
  id: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: "user" | "admin";
    image: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export type SecurityEvent = {
  id: string;
  type: string;
  severity: string;
  userId: string | null;
  ipAddress: string | null;
  detail: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
    image: string | null;
  } | null;
};

export type AuditLog = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  } | null;
};

export type AuditLogsResponse = {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
};

type QueryParams = Record<string, string | number | boolean | undefined>;

function buildUrl(apiUrl: string, path: string, params?: QueryParams) {
  const url = new URL(path, apiUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function getJson<T>(apiUrl: string, path: string, params?: QueryParams): Promise<T> {
  return fetchJson<T>(buildUrl(apiUrl, path, params), {
    credentials: "include",
  });
}

async function requestJson<T>(apiUrl: string, path: string, init: RequestInit): Promise<T> {
  return fetchJson<T>(buildUrl(apiUrl, path), {
    credentials: "include",
    ...init,
    headers: buildHeaders(init),
  });
}

export async function fetchAdminOverview(apiUrl: string) {
  return getJson<AdminOverview>(apiUrl, "/api/admin/overview");
}

export async function fetchSystemHealth(apiUrl: string) {
  return getJson<SystemHealth>(apiUrl, "/api/admin/system/health");
}

export async function fetchAdminUsers(
  apiUrl: string,
  params: { q?: string; limit?: number; offset?: number }
) {
  return getJson<AdminUsersResponse>(apiUrl, "/api/admin/users", params);
}

export async function fetchAdminUserDetails(apiUrl: string, userId: string) {
  return getJson<{ user: AdminUserDetails }>(apiUrl, `/api/admin/users/${userId}`);
}

export async function fetchTrials(
  apiUrl: string,
  params: { page?: number; limit?: number; phone?: string; user?: string }
) {
  return getJson<TrialsResponse>(apiUrl, "/api/admin/trials", params);
}

export async function fetchWhatsappOps(apiUrl: string) {
  return getJson<WhatsappOpsSnapshot>(apiUrl, "/api/admin/whatsapp/ops");
}

export async function fetchBillingSubscriptions(apiUrl: string) {
  return getJson<{ subscriptions: SubscriptionResponse[] }>(apiUrl, "/api/admin/billing/subscriptions");
}

export async function fetchBillingInvoices(apiUrl: string) {
  return getJson<{ invoices: InvoiceResponse[] }>(apiUrl, "/api/admin/billing/invoices");
}

export async function fetchSecuritySessions(apiUrl: string) {
  return getJson<{ sessions: SecuritySession[] }>(apiUrl, "/api/admin/security/sessions");
}

export async function fetchSecurityEvents(apiUrl: string) {
  return getJson<{ events: SecurityEvent[] }>(apiUrl, "/api/admin/security/events");
}

export async function fetchAuditLogs(
  apiUrl: string,
  params: { actor?: string; action?: string; page?: number; limit?: number }
) {
  return getJson<AuditLogsResponse>(apiUrl, "/api/admin/audit-logs", params);
}

export async function updateUserRole(apiUrl: string, userId: string, role: AdminUserListItem["role"]) {
  return requestJson<{ user: AdminUserListItem }>(apiUrl, `/api/admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function bulkUpdateUserRole(
  apiUrl: string,
  userIds: string[],
  role: AdminUserListItem["role"]
) {
  return requestJson<{ updatedCount: number }>(apiUrl, "/api/admin/users/bulk/role", {
    method: "PATCH",
    body: JSON.stringify({ userIds, role }),
  });
}

export async function suspendUser(apiUrl: string, userId: string) {
  return requestJson<{ user: AdminUserListItem }>(apiUrl, `/api/admin/users/${userId}/suspend`, {
    method: "PATCH",
  });
}

export async function unsuspendUser(apiUrl: string, userId: string) {
  return requestJson<{ user: AdminUserListItem }>(apiUrl, `/api/admin/users/${userId}/unsuspend`, {
    method: "PATCH",
  });
}

export async function bulkSetUserSuspension(apiUrl: string, userIds: string[], suspended: boolean) {
  return requestJson<{ updatedCount: number }>(apiUrl, "/api/admin/users/bulk/suspension", {
    method: "PATCH",
    body: JSON.stringify({ userIds, suspended }),
  });
}

export async function updateSubscriptionStatus(
  apiUrl: string,
  subscriptionId: string,
  status: SubscriptionResponse["status"]
) {
  return requestJson<{ subscription: SubscriptionResponse }>(apiUrl, `/api/admin/billing/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function updateInvoiceStatus(
  apiUrl: string,
  invoiceId: string,
  status: InvoiceResponse["status"]
) {
  return requestJson<{ invoice: InvoiceResponse }>(apiUrl, `/api/admin/billing/invoices/${invoiceId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function revokeSecuritySession(apiUrl: string, sessionId: string) {
  return requestJson<{ message: string; sessionId: string }>(apiUrl, "/api/admin/security/sessions/revoke", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export { ApiResponseError };
