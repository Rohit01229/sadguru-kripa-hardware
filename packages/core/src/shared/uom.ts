import Decimal from "decimal.js";
import { DomainError, FractionalPieceError } from "./errors";

export type UnitKind = "MEASURED" | "PIECE";

export interface SaleUnitRef {
  code: string;
  kind: UnitKind;
  factorToBase: Decimal.Value;
}

/**
 * Convert a sale-unit quantity to base units: baseQty = saleQty × factorToBase (03 §4).
 * MEASURED units allow decimals; PIECE units reject fractional quantities.
 */
export function toBaseQty(saleQty: Decimal.Value, unit: SaleUnitRef): Decimal {
  const qty = new Decimal(saleQty);
  if (qty.isNegative()) {
    throw new DomainError("Quantity must be non-negative", "NEGATIVE_QTY");
  }
  if (unit.kind === "PIECE" && !qty.isInteger()) {
    throw new FractionalPieceError(unit.code);
  }
  return qty.times(unit.factorToBase);
}
