import { Hono } from "hono";
import { requireAdmin } from "../../../../core/middleware";
import * as securityController from "../controllers";

const router = new Hono();

router.use("/*", requireAdmin);

router.get("/sessions", securityController.getSessions);
router.post("/sessions/revoke", securityController.revokeSession);
router.get("/events", securityController.getSecurityEvents);

export { router as adminSecurityRouter };
