import { useState } from "react";
import {
  Activity,
  BadgeCheck,
  Bot,
  CreditCard,
  FileClock,
  ShieldAlert,
  Users,
} from "lucide-react";
import { AdminLayout, type AdminNavItem } from "@/components/admin/AdminLayout";
import { useSession } from "@/lib/auth-client";
import { useApiUrl } from "@/hooks/useApi";
import {
  AuditLogsSection,
  BillingSection,
  OverviewSection,
  SecuritySection,
  TrialsSection,
  UsersSection,
  WhatsappOpsSection,
} from "./AdminSections";

type AdminSection =
  | "overview"
  | "users"
  | "whatsapp-ops"
  | "trials"
  | "billing"
  | "security"
  | "audit-logs";

const NAV_ITEMS: AdminNavItem<AdminSection>[] = [
  { id: "overview", label: "Overview", icon: Activity, description: "Health, usage, and alerts" },
  { id: "users", label: "Users", icon: Users, description: "Accounts and access" },
  { id: "whatsapp-ops", label: "WhatsApp Ops", icon: Bot, description: "Connections and queues" },
  { id: "trials", label: "Trials", icon: BadgeCheck, description: "Trial status and conversion" },
  { id: "billing", label: "Billing", icon: CreditCard, description: "Plans, invoices, and usage" },
  { id: "security", label: "Security", icon: ShieldAlert, description: "Sessions and security events" },
  { id: "audit-logs", label: "Audit Logs", icon: FileClock, description: "Admin actions and events" },
];

export default function AdminPage() {
  const { data: session } = useSession();
  const apiUrl = useApiUrl();
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");

  const userName = session?.user?.name ?? session?.user?.email ?? "Admin";

  return (
    <AdminLayout
      title="Admin Console"
      subtitle="Platform management"
      navItems={NAV_ITEMS}
      activeId={activeSection}
      onSelect={setActiveSection}
      userName={userName}
    >
      {activeSection === "overview" ? <OverviewSection apiUrl={apiUrl} /> : null}
      {activeSection === "users" ? <UsersSection apiUrl={apiUrl} canEditRoles /> : null}
      {activeSection === "whatsapp-ops" ? <WhatsappOpsSection apiUrl={apiUrl} /> : null}
      {activeSection === "trials" ? <TrialsSection apiUrl={apiUrl} /> : null}
      {activeSection === "billing" ? <BillingSection apiUrl={apiUrl} canUpdateBilling={true} /> : null}
      {activeSection === "security" ? <SecuritySection apiUrl={apiUrl} /> : null}
      {activeSection === "audit-logs" ? <AuditLogsSection apiUrl={apiUrl} /> : null}
    </AdminLayout>
  );
}
