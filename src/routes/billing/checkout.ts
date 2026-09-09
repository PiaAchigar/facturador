import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { resolveArcaConfig } from "../../arca/factory";
import { createDb } from "../../db/client";
import { checkout } from "../../services/checkout.service";
import type { AppBindings } from "../../env";

const checkoutRouter = new Hono<{ Bindings: AppBindings }>();

const itemSchema = z
  .object({
    serviceId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    /** Concepto libre (una compra): trae su texto y su precio. */
    description: z.string().min(1).max(255).optional(),
    customerPurchaseId: z.string().uuid().optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative().optional(),
    priceMode: z.enum(["list", "cash"]).optional(),
    billable: z.boolean().optional(),
  })
  .refine(
    (i) =>
      // Servicio o producto, nunca los dos; o un concepto libre con su precio.
      (Boolean(i.serviceId) !== Boolean(i.productId)) ||
      (!i.serviceId && !i.productId && Boolean(i.description) && i.unitPrice != null),
    {
      message:
        "Cada ítem necesita serviceId, productId (no ambos), o una descripción con su precio",
    },
  );

const body = z.object({
  customerId: z.string().uuid(),
  /** Con qué identidad fiscal se factura. Si no viene, la marcada por defecto. */
  issuerId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  customerPurchaseId: z.string().uuid().optional(),
  items: z.array(itemSchema),
  payment: z.object({
    method: z.enum(["cash", "bank_transfer", "mercadopago", "debit_card", "credit_card"]),
    amount: z.number().positive(),
    wantsInvoice: z.boolean(),
    paidToProviderId: z.string().uuid().optional(),
  }),
  notes: z.string().max(1000).optional(),
});

checkoutRouter.post("/", zValidator("json", body), async (c) => {
  const db = createDb(c.env);
  const input = c.req.valid("json");
  const arca = await resolveArcaConfig(db, c.env, input.issuerId);
  const result = await checkout(db, arca, input);
  return c.json(result, 201);
});

export { checkoutRouter };
