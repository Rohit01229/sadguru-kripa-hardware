/** India GST financial year (April→March). 2026-06 → "2026-27"; 2026-02 → "2025-26". */
export function financialYear(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0 = Jan
  const startYear = m >= 3 ? y : y - 1; // April (3) onwards starts the new FY
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

/** Gapless invoice-number format (03 §7): "<FY>/<6-digit seq>". */
export function formatInvoiceNo(fy: string, seq: number): string {
  return `${fy}/${String(seq).padStart(6, "0")}`;
}
