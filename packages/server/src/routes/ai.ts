import { Hono } from "hono";
import * as aiController from "../controllers/ai.controller";

const router = new Hono();

// AI Response generation
router.post("/response", aiController.generateResponse);

// AI Settings
router.get("/settings", aiController.getSettings);
router.post("/settings", aiController.updateSettings);

// Contact Persona
router.get("/persona/:contactPhone", aiController.getPersona);
router.post("/persona/:contactPhone/refresh", aiController.refreshPersona);

// Message History
router.get("/history/:contactPhone", aiController.getHistory);

// API Usage Stats
router.get("/usage", aiController.getUsage);

export { router as aiRouter };
