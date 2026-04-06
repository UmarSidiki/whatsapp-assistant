import { Hono } from "hono";
import { requireAdmin } from "../../../core/auth-middleware";
import * as billingController from "./billing.controller";

const router = new Hono();

router.use("/*", requireAdmin);

router.get("/subscriptions", billingController.listSubscriptions);
router.patch("/subscriptions/:id", billingController.patchSubscription);

router.get("/invoices", billingController.listInvoices);
router.post("/invoices", billingController.postInvoice);
router.patch("/invoices/:id", billingController.patchInvoice);

export { router as billingRouter };
