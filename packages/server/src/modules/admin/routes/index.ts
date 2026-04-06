import { Hono } from "hono";
import { requireAdmin } from "../../../core/middleware";
import { billingRouter } from "../billing/routes";
import { usersRouter } from "../users/routes";
import { adminSecurityRouter } from "../security/routes";
import * as admin from "../controllers";
import * as auditLogs from "../controllers";

const router = new Hono();

router.use("/*", requireAdmin);

router.get("/overview", admin.getOverview);
router.get("/system/health", admin.getSystemHealth);
router.get("/trials", admin.listTrials);
router.get("/whatsapp/ops", admin.getWhatsappOps);
router.get("/audit-logs", auditLogs.getAuditLogs);
router.route("/users", usersRouter);
router.route("/security", adminSecurityRouter);
router.route("/billing", billingRouter);

export { router as adminRouter };
