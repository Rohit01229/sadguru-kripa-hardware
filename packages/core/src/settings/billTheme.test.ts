import { describe, it, expect } from "vitest";
import {
  billThemeSchema,
  readBillTheme,
  substituteTokens,
  BILL_THEME_PRESETS,
  DEFAULT_BILL_THEME,
} from "./billTheme";

describe("billThemeSchema", () => {
  it("fills every field from an empty object", () => {
    const t = billThemeSchema.parse({});
    expect(t.accent).toBe("espresso");
    expect(t.baseSizePt).toBe(10);
    expect(t.showHsnColumn).toBe(true);
  });

  it("rejects a size outside the printable range", () => {
    expect(billThemeSchema.safeParse({ baseSizePt: 4 }).success).toBe(false);
    expect(billThemeSchema.safeParse({ baseSizePt: 40 }).success).toBe(false);
  });

  it("rejects an accent outside the closed token set", () => {
    // The whole point of tokens-not-hex: a config can never carry an arbitrary value.
    expect(billThemeSchema.safeParse({ accent: "#ff0000" }).success).toBe(false);
    expect(billThemeSchema.safeParse({ accent: "rgb(1,2,3)" }).success).toBe(false);
  });

  it("drops unknown keys instead of storing them", () => {
    const t = billThemeSchema.parse({ accent: "ink", evilCss: "body{display:none}" });
    expect(t).not.toHaveProperty("evilCss");
  });

  it("caps free text so a theme cannot become a document", () => {
    expect(billThemeSchema.safeParse({ footerNote: "x".repeat(500) }).success).toBe(false);
  });

  it("has no switch for anything a tax invoice legally requires", () => {
    // GSTIN, tax breakup, amount in words and the invoice number must always print, so
    // there must be no key that could turn them off.
    const keys = Object.keys(billThemeSchema.parse({}));
    for (const forbidden of ["showGstin", "showTaxBreakup", "showAmountInWords", "showInvoiceNo", "showTotals"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("readBillTheme", () => {
  it("returns defaults for a shop that never opened the editor", () => {
    expect(readBillTheme(null)).toEqual(DEFAULT_BILL_THEME);
    expect(readBillTheme(undefined)).toEqual(DEFAULT_BILL_THEME);
  });

  it("falls back to defaults rather than throwing on corrupt stored JSON", () => {
    // A theme is cosmetic — a bad blob must never stop a shop printing a bill.
    expect(readBillTheme({ accent: "not-a-token", baseSizePt: 999 })).toEqual(DEFAULT_BILL_THEME);
    expect(readBillTheme("garbage")).toEqual(DEFAULT_BILL_THEME);
  });

  it("round-trips a valid stored theme", () => {
    const saved = billThemeSchema.parse({ accent: "amber", tableBorders: "boxed", showTerms: false });
    const read = readBillTheme(JSON.parse(JSON.stringify(saved)));
    expect(read.accent).toBe("amber");
    expect(read.tableBorders).toBe("boxed");
    expect(read.showTerms).toBe(false);
  });
});

describe("substituteTokens", () => {
  it("fills the allow-listed tokens", () => {
    expect(substituteTokens("Thanks from {{shop.name}}", { shopName: "Sadguru Kripa" })).toBe(
      "Thanks from Sadguru Kripa",
    );
    expect(substituteTokens("Bill {{invoice.no}}", { invoiceNo: "2026-27/000123" })).toBe("Bill 2026-27/000123");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(substituteTokens("{{ shop.name }}", { shopName: "X" })).toBe("X");
  });

  it("strips unknown tokens rather than evaluating anything", () => {
    expect(substituteTokens("{{process.env.SECRET}} {{__proto__}}", {})).toBe(" ");
  });

  // Regression: with a plain object lookup, `{{constructor}}` resolved through the
  // prototype chain and printed "function Object() { [native code] }" on the bill.
  it("does not leak Object.prototype members onto the invoice", () => {
    for (const token of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(substituteTokens(`[{{${token}}}]`, { shopName: "X" })).toBe("[]");
    }
  });

  it("blanks a known token with no value", () => {
    expect(substituteTokens("[{{customer.name}}]", {})).toBe("[]");
  });
});

describe("presets", () => {
  it("are all valid themes", () => {
    for (const p of BILL_THEME_PRESETS) {
      expect(billThemeSchema.safeParse(p.theme).success, p.key).toBe(true);
    }
  });

  it("have unique keys and are visibly different from one another", () => {
    const keys = BILL_THEME_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const fingerprints = BILL_THEME_PRESETS.map((p) => JSON.stringify(p.theme));
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});
