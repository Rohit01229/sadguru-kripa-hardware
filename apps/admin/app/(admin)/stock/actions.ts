"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  recordGrn,
  adjustStock,
  setStockLevel,
  recordReturn,
  createSupplier,
  editSupplier,
  recordGrnSchema,
  adjustStockSchema,
  setStockLevelSchema,
  recordReturnSchema,
  upsertSupplierSchema,
  DomainError,
  Forbidden,
  InsufficientStock,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Stock server actions (transport, S3). Each: resolve the staff session, Zod-
// validate via the ONE core schema, call the core service (which requirePermission
// + audit in one tx), then revalidate. Returns a flat { ok | error } so client
// forms render inline errors. UI hiding is cosmetic; the core guard is the gate.

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

async function toState(e: unknown): Promise<ActionState> {
  const t = await getTranslations("stock");
  if (e instanceof Forbidden) return { error: t("errors.forbidden") };
  if (e instanceof InsufficientStock)
    return { error: t("errors.insufficientStock") };
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    // The field path is data, not chrome, so it stays untranslated; only the
    // fallback when there is no issue is localised.
    return { error: first ? `${first.path.join(".")}: ${first.message}` : t("errors.invalidInput") };
  }
  if (e instanceof DomainError) {
    switch (e.code) {
      case "NOT_FOUND":
        return { error: t("errors.notFound") };
      case "FRACTIONAL_PIECE":
        return { error: t("errors.fractionalPiece") };
      case "IDEMPOTENCY_MISMATCH":
        return { error: t("errors.idempotencyMismatch") };
      default:
        return { error: e.message };
    }
  }
  return { error: t("errors.generic") };
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

const boolFrom = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

/** Parse the dynamic GRN line rows out of the form. */
function parseGrnLines(form: FormData) {
  const productIds = form.getAll("productId").map(String);
  const receiveUnitIds = form.getAll("receiveUnitId").map(String);
  const quantities = form.getAll("quantity").map(String);
  const batchNos = form.getAll("batchNo").map(String);
  const expiries = form.getAll("expiryDate").map(String);
  const costs = form.getAll("costPerReceiveUnit").map(String);
  const lines = [];
  for (let i = 0; i < productIds.length; i++) {
    if (!productIds[i] || !quantities[i]) continue;
    lines.push({
      productId: productIds[i]!,
      receiveUnitId: receiveUnitIds[i]!,
      quantity: quantities[i]!,
      batchNo: batchNos[i] && batchNos[i] !== "" ? batchNos[i] : null,
      expiryDate: expiries[i] && expiries[i] !== "" ? new Date(expiries[i]!).toISOString() : null,
      costPerReceiveUnit: costs[i] ? Math.round(Number(costs[i]) * 100) : 0,
    });
  }
  return lines;
}

export async function recordGrnAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = recordGrnSchema.parse({
      supplierId: form.get("supplierId") || null,
      supplierInvoiceNo: form.get("supplierInvoiceNo") || null,
      note: form.get("note") || null,
      lines: parseGrnLines(form),
    });
    // Each form submit carries a fresh idempotency key so a double-click is a no-op.
    const idempotencyKey = String(form.get("idempotencyKey") || randomUUID());
    const grn = await recordGrn(input, { ...c, idempotencyKey });
    revalidatePath("/stock");
    revalidatePath("/stock/movements");
    return { ok: true, id: grn.id };
  } catch (e) {
    return await toState(e);
  }
}

export async function adjustStockAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = adjustStockSchema.parse({
      productId: form.get("productId"),
      direction: form.get("direction"),
      saleUnitId: form.get("saleUnitId"),
      quantity: String(form.get("quantity") ?? ""),
      reason: String(form.get("reason") ?? ""),
      allowNegative: boolFrom(form.get("allowNegative")),
      batchNo: form.get("batchNo") || null,
    });
    const mv = await adjustStock(input, c);
    revalidatePath("/stock");
    revalidatePath("/stock/movements");
    return { ok: true, id: mv.id };
  } catch (e) {
    return await toState(e);
  }
}

export async function setStockLevelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = setStockLevelSchema.parse({
      productId: form.get("productId"),
      onHand: String(form.get("onHand") ?? ""),
      reason: form.get("reason") ? String(form.get("reason")) : undefined,
    });
    const mv = await setStockLevel(input, c);
    revalidatePath("/stock");
    revalidatePath("/stock/movements");
    return { ok: true, id: mv?.id };
  } catch (e) {
    return await toState(e);
  }
}

export async function recordReturnAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = recordReturnSchema.parse({
      productId: form.get("productId"),
      kind: form.get("kind"),
      saleUnitId: form.get("saleUnitId"),
      quantity: String(form.get("quantity") ?? ""),
      reason: String(form.get("reason") ?? ""),
      refId: form.get("refId") || null,
      allowNegative: boolFrom(form.get("allowNegative")),
    });
    const mv = await recordReturn(input, c);
    revalidatePath("/stock");
    revalidatePath("/stock/movements");
    return { ok: true, id: mv.id };
  } catch (e) {
    return await toState(e);
  }
}

export async function createSupplierAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = upsertSupplierSchema.parse({
      name: form.get("name"),
      gstin: form.get("gstin") || null,
      phone: form.get("phone") || null,
      address: form.get("address") || null,
    });
    const s = await createSupplier(input, c);
    revalidatePath("/stock/suppliers");
    return { ok: true, id: s.id };
  } catch (e) {
    return await toState(e);
  }
}

export async function editSupplierAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = upsertSupplierSchema.parse({
      name: form.get("name"),
      gstin: form.get("gstin") || null,
      phone: form.get("phone") || null,
      address: form.get("address") || null,
    });
    await editSupplier(id, input, c);
    revalidatePath("/stock/suppliers");
    return { ok: true, id };
  } catch (e) {
    return await toState(e);
  }
}
