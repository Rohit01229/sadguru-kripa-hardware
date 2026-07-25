import Decimal from "decimal.js";

export interface LineTax {
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}

/** Place-of-supply split (03 §8): intra-state → CGST+SGST; inter-state → IGST. */
export function computeLineTax(
  taxable: Decimal.Value,
  ratePct: Decimal.Value,
  supplyState: string,
  homeState: string,
): LineTax {
  const t = new Decimal(taxable);
  const rate = new Decimal(ratePct);
  const zero = new Decimal(0);
  if (supplyState === homeState) {
    const half = t.times(rate).div(100).div(2);
    return { cgst: half, sgst: half, igst: zero };
  }
  return { cgst: zero, sgst: zero, igst: t.times(rate).div(100) };
}

/** Back-calculate taxable value from an MRP-inclusive price (03 §8). */
export function backCalcTaxable(mrpInclusive: Decimal.Value, ratePct: Decimal.Value): Decimal {
  const mrp = new Decimal(mrpInclusive);
  const rate = new Decimal(ratePct);
  return mrp.times(100).div(rate.plus(100));
}
