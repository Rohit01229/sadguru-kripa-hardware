// Storefront transport error mapping (04 §2) — same envelope as admin. The
// storefront carries customer sessions; an ownership/permission miss maps to 403,
// an oversell at placement to 409 STOCK_INSUFFICIENT (04 §8.5).
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError, Forbidden, InsufficientStock } from "@hardware/core";

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { path: string; issue: string }[]; requestId?: string };
}

function envelope(
  code: string,
  message: string,
  requestId?: string,
  details?: { path: string; issue: string }[],
): ErrorEnvelope {
  return { error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) } };
}

/** 401 — no/invalid customer session (04 §2). */
export function unauthenticated(requestId?: string): NextResponse {
  return NextResponse.json(envelope("UNAUTHENTICATED", "Sign in to continue.", requestId), { status: 401 });
}

export function errorResponse(e: unknown, requestId?: string): NextResponse {
  if (e instanceof ZodError) {
    return NextResponse.json(
      envelope(
        "VALIDATION_FAILED",
        "One or more fields are invalid.",
        requestId,
        e.issues.map((iss) => ({ path: iss.path.join("."), issue: iss.message })),
      ),
      { status: 400 },
    );
  }
  // InsufficientStock is a DomainError subclass — check it BEFORE Forbidden/DomainError.
  if (e instanceof InsufficientStock) {
    return NextResponse.json(envelope("STOCK_INSUFFICIENT", e.message, requestId), { status: 409 });
  }
  if (e instanceof Forbidden) {
    return NextResponse.json(envelope("FORBIDDEN", e.message, requestId), { status: 403 });
  }
  if (e instanceof DomainError) {
    const status = statusForDomainCode(e.code);
    return NextResponse.json(envelope(e.code, e.message, requestId), { status });
  }
  return NextResponse.json(envelope("INTERNAL", "Something went wrong.", requestId), { status: 500 });
}

function statusForDomainCode(code: string): number {
  switch (code) {
    case "NOT_FOUND":
    case "NOT_AVAILABLE":
      return 404;
    case "STOCK_INSUFFICIENT":
    case "INSUFFICIENT_STOCK":
    case "IDEMPOTENCY_MISMATCH":
    case "ALREADY_CANCELLED":
    case "ALREADY_DISPATCHED":
      return 409;
    case "FRACTIONAL_PIECE":
    case "ADDRESS_REQUIRED":
      return 400;
    default:
      return 422;
  }
}
