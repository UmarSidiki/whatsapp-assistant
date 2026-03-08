import { Hono } from "hono";
import { requireAuth } from "../../core/auth-middleware";
import * as aiController from "./ai.controller";

const router = new Hono();

// All routes require auth
router.use("/*", requireAuth);

// AI Settings
router.get("/settings", aiController.getSettings);
router.post("/settings", aiController.updateSettings);

// API Keys Management - Groq
router.post("/api-keys/groq", aiController.addGroqApiKey);
router.delete("/api-keys/groq/:keyId", aiController.removeGroqApiKey);
router.get("/api-keys/groq", aiController.getGroqApiKeys);

// API Keys Management - Gemini
router.post("/api-keys/gemini", aiController.addGeminiApiKey);
router.delete("/api-keys/gemini/:keyId", aiController.removeGeminiApiKey);
router.get("/api-keys/gemini", aiController.getGeminiApiKeys);

// Contacts list
router.get("/contacts", aiController.getContacts);

// Contact Persona
router.get("/persona/:contactPhone", aiController.getPersona);
router.post("/persona/:contactPhone/refresh", aiController.refreshPersona);
router.post("/refresh-persona", aiController.refreshPersona);
router.post("/refresh-all-personas", aiController.refreshAllPersonas);

// Message History
router.get("/history/:contactPhone", aiController.getHistory);

// API Usage Stats
router.get("/usage", aiController.getUsage);

// Test connection
router.post("/test-connection", aiController.testConnection);

// Mimic mode toggle
router.post("/mimic-mode", aiController.toggleMimicMode);

export { router as aiRouter };
