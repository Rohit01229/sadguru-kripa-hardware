import { describe, it, expect } from "vitest";
import { financialYear, formatInvoiceNo } from "./numbering";

describe("billing numbering", () => {
  it("computes the GST financial year (April→March)", () => {
    expect(financialYear(new Date("2026-06-24T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-02-10T00:00:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-03-31T00:00:00Z"))).toBe("2025-26");
  });
  it("formats a gapless invoice number", () => {
    expect(formatInvoiceNo("2026-27", 124)).toBe("2026-27/000124");
  });
});
