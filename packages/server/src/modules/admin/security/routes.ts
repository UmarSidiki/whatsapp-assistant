import { Hono } from "hono";
import { requireAdmin } from "../../../core/auth-middleware";
import * as securityController from "./security.controller";

const router = new Hono();

router.use("/*", requireAdmin);

router.get("/sessions", securityController.getSessions);
router.post("/sessions/revoke", securityController.revokeSession);
router.get("/events", securityController.getSecurityEvents);

export { router as adminSecurityRouter };
