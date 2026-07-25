// Transport-layer error mapping (04 §2). Core throws typed DomainError /
// Forbidden / ZodError; this maps them to the standard error envelope + the right
// HTTP status. Used by route handlers; server actions surface a flatter
// { error } shape for forms (see actions).
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError, Forbidden, InsufficientStock } from "@hardware/core";

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: { path: string; issue: string }[];
    requestId?: string;
  };
}

function envelope(
  code: string,
  message: string,
  requestId?: string,
  details?: { path: string; issue: string }[],
): ErrorEnvelope {
  return { error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) } };
}

/** 401 — no/invalid session (04 §2). */
export function unauthenticated(requestId?: string): NextResponse {
  return NextResponse.json(envelope("UNAUTHENTICATED", "Authentication required.", requestId), {
    status: 401,
  });
}

/** Map a thrown error to a NextResponse with the 04 §2 envelope + status code. */
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
  if (e instanceof Forbidden) {
    return NextResponse.json(envelope("FORBIDDEN", e.message, requestId), { status: 403 });
  }
  if (e instanceof InsufficientStock) {
    return NextResponse.json(envelope("STOCK_INSUFFICIENT", e.message, requestId), { status: 409 });
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
      return 404;
    case "DUP_SKU":
    case "DUP_UNIT_CODE":
    case "DUP_NAME":
    case "DUP_SALE_UNIT":
    case "DUP_SLAB":
    case "DUPLICATE":
    case "IDEMPOTENCY_MISMATCH":
    case "ALREADY_DISPATCHED":
    case "ALREADY_CANCELLED":
      return 409;
    case "FK_VIOLATION":
    case "FRACTIONAL_PIECE":
    case "NEGATIVE_QTY":
    case "MULTI_DEFAULT":
      return 400;
    default:
      return 422;
  }
}
