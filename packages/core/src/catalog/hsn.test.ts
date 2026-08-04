import { describe, it, expect } from "vitest";
import { searchHsn, HSN_CATALOG } from "./hsn";

describe("searchHsn", () => {
  it("finds the heading from a bare product noun", () => {
    const [top] = searchHsn("cement");
    expect(top?.code).toBe("2523");
    expect(top?.gstRatePct).toBe("18");
  });

  it("finds the heading inside a real shop item name", () => {
    // The name a shopkeeper actually types — brand + noun + pack size.
    const [top] = searchHsn("UltraTech PPC Cement 50 kg");
    expect(top?.code).toBe("2523");
  });

  it("matches Hindi-English shop vernacular", () => {
    expect(searchHsn("sariya")[0]?.code).toBe("7213"); // TMT bars
    expect(searchHsn("tala")[0]?.code).toBe("8301"); // locks
    expect(searchHsn("kabza")[0]?.code).toBe("8302"); // hinges
  });

  it("separates the fastener headings a hardware shop cares about", () => {
    expect(searchHsn("screw")[0]?.code).toBe("7318");
    expect(searchHsn("nail")[0]?.code).toBe("7317");
  });

  it("looks up by the code itself", () => {
    expect(searchHsn("3917")[0]?.code).toBe("3917");
  });

  it("returns nothing for a too-short or unmatched query", () => {
    expect(searchHsn("c")).toEqual([]);
    expect(searchHsn("")).toEqual([]);
    // Better to return nothing than to guess a plausible-but-wrong classification.
    expect(searchHsn("zzzzqqqq")).toEqual([]);
  });

  it("honours the result limit", () => {
    expect(searchHsn("pipe", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("HSN_CATALOG", () => {
  it("has unique 4-digit codes", () => {
    const codes = HSN_CATALOG.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^\d{4}$/);
  });

  it("only carries real GST slabs", () => {
    const slabs = new Set(["0", "0.25", "3", "5", "12", "18", "28"]);
    for (const e of HSN_CATALOG) expect(slabs.has(e.gstRatePct)).toBe(true);
  });

  it("gives every entry searchable lowercase keywords", () => {
    for (const e of HSN_CATALOG) {
      expect(e.keywords.length).toBeGreaterThan(0);
      for (const k of e.keywords) expect(k).toBe(k.toLowerCase());
    }
  });
});
