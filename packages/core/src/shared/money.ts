import Decimal from "decimal.js";

export { Decimal };
export type Money = Decimal;

export function money(v: Decimal.Value): Decimal {
  return new Decimal(v);
}

/** Rupees → integer paise for the transport boundary (03 A1, 04). */
export function toPaise(rupees: Decimal.Value): number {
  return new Decimal(rupees).times(100).round().toNumber();
}

/** Integer paise → rupee Decimal. */
export function fromPaise(paise: number): Decimal {
  return new Decimal(paise).div(100);
}

/** GST invoice round-to-nearest-rupee (03 §8). */
export function roundToRupee(amount: Decimal.Value): Decimal {
  return new Decimal(amount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}
