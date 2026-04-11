import { Hono } from "hono";
import { requireAuth } from "../../../core/middleware";
import * as connection from "../controllers";
import * as message from "../../messaging/controllers";
import * as bulk from "../../bulk/controllers";
import * as schedule from "../../scheduling/controllers";
import * as autoreply from "../../auto-reply/controllers";
import * as flow from "../../flow/controllers";
import * as stats from "../../analytics/controllers";
import * as templates from "../../templates/controllers";
import * as chats from "../controllers/chats.controller";
import * as settings from "../controllers/settings.controller";

const router = new Hono();

// All routes require auth
router.use("/*", requireAuth);

// Connection
router.post("/init", connection.initConnection);
router.get("/status", connection.getStatus);
router.post("/disconnect", connection.disconnect);
router.get("/stats", stats.getStats);
router.get("/chats", chats.getChats);
router.get("/chats/bootstrap", chats.getChatsBootstrap);
router.get("/chats/:chatId/messages", chats.getChatMessages);
router.get("/messages/:messageId/media", chats.getMessageMedia);
router.get("/settings", settings.getSettings);
router.post("/settings", settings.updateSettings);

// Single message
router.post("/send", message.sendMessage);
router.post("/send-media", message.sendMedia);

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

// Chatbot Flows
router.get("/flows", flow.getFlows);
router.get("/flows/:id", flow.getFlow);
router.post("/flows", flow.createFlow);
router.patch("/flows/:id", flow.updateFlow);
router.delete("/flows/:id", flow.deleteFlow);
router.post("/flows/upload-image", flow.uploadFlowImage);
router.get("/flows/images/:assetId", flow.getFlowImage);

// CTA Buttons
router.post("/send-buttons", flow.sendCtaButtons);

export { router as whatsappRouter };
