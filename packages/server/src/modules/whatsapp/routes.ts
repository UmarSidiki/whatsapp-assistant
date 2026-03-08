import { Hono } from "hono";
import { requireAuth } from "../../core/auth-middleware";
import * as connection from "./connection.controller";
import * as message from "../messaging/message.controller";
import * as bulk from "../bulk/bulk.controller";
import * as schedule from "../scheduling/schedule.controller";
import * as autoreply from "../auto-reply/autoreply.controller";
import * as stats from "../analytics/stats.controller";
import * as templates from "../templates/templates.controller";

const router = new Hono();

// All routes require auth
router.use("/*", requireAuth);

// Connection
router.post("/init", connection.initConnection);
router.get("/status", connection.getStatus);
router.post("/disconnect", connection.disconnect);

// Single message
router.post("/send", message.sendMessage);

// Bulk messages
router.post("/bulk-send", bulk.startBulkSend);
router.get("/bulk-status", bulk.getBulkStatus);
router.post("/bulk-stop", bulk.stopBulk);

// Schedule
router.get("/schedule", schedule.getScheduledMessages);
router.post("/schedule", schedule.addScheduledMessage);
router.delete("/schedule/:id", schedule.cancelScheduledMessage);

// Auto-reply
router.get("/auto-reply", autoreply.getAutoReplyRules);
router.post("/auto-reply", autoreply.addAutoReplyRule);
router.patch("/auto-reply/:id", autoreply.updateAutoReplyRule);
router.delete("/auto-reply/:id", autoreply.deleteAutoReplyRule);

// Templates
router.get("/templates", templates.getTemplates);
router.post("/templates", templates.createTemplate);
router.delete("/templates/:id", templates.deleteTemplate);

export { router as whatsappRouter };
