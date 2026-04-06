import { Hono } from "hono";
import { requireAdmin } from "../../../../core/middleware";
import * as usersController from "../controllers";

const router = new Hono();

router.use("/*", requireAdmin);

router.get("/", usersController.listUsers);
router.patch("/bulk/role", usersController.patchBulkUserRole);
router.patch("/bulk/suspension", usersController.patchBulkUserSuspension);
router.get("/:id", usersController.getUser);
router.patch("/:id/role", usersController.patchUserRole);
router.patch("/:id/suspend", usersController.suspendUser);
router.patch("/:id/unsuspend", usersController.unsuspendUser);

export { router as usersRouter };
