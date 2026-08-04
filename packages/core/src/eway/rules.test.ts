import { describe, it, expect } from "vitest";
import {
  ewayBillRequired,
  validityDays,
  validUntil,
  documentTooOld,
  withinCancelWindow,
  INTERSTATE_THRESHOLD_PAISE,
  DEFAULT_INTRASTATE_THRESHOLD_PAISE,
  MAX_DOCUMENT_AGE_DAYS,
} from "./rules";
import { toUqc, hasExactUqc, UQC_CODES } from "../shared/uqc";

const RS = (n: number) => n * 100; // rupees → paise

describe("ewayBillRequired — thresholds", () => {
  it("needs a bill above ₹50,000 between states", () => {
    const d = ewayBillRequired({ consignmentValuePaise: RS(50_001), fromStateCode: "19", toStateCode: "27" });
    expect(d.required).toBe(true);
    expect(d.interState).toBe(true);
    expect(d.thresholdPaise).toBe(INTERSTATE_THRESHOLD_PAISE);
  });

  it("does NOT need one exactly AT the threshold — Rule 138 says 'exceeds'", () => {
    const d = ewayBillRequired({ consignmentValuePaise: RS(50_000), fromStateCode: "19", toStateCode: "27" });
    expect(d.required).toBe(false);
  });

  it("uses the state's own intra-state figure where it differs", () => {
    // Tamil Nadu allows ₹1 lakh within the state...
    const tn = ewayBillRequired({ consignmentValuePaise: RS(75_000), fromStateCode: "33", toStateCode: "33" });
    expect(tn.required).toBe(false);
    expect(tn.thresholdPaise).toBe(RS(100_000));
    // ...but the same value CROSSING a border always needs one.
    const out = ewayBillRequired({ consignmentValuePaise: RS(75_000), fromStateCode: "33", toStateCode: "29" });
    expect(out.required).toBe(true);
    expect(out.thresholdPaise).toBe(INTERSTATE_THRESHOLD_PAISE);
  });

  it("defaults an unlisted state to ₹50,000 — over-warning is the safe direction", () => {
    const d = ewayBillRequired({ consignmentValuePaise: RS(60_000), fromStateCode: "19", toStateCode: "19" });
    expect(d.thresholdPaise).toBe(DEFAULT_INTRASTATE_THRESHOLD_PAISE);
    expect(d.required).toBe(true);
  });

  it("honours a shop's own override", () => {
    const d = ewayBillRequired({
      consignmentValuePaise: RS(75_000),
      fromStateCode: "19",
      toStateCode: "19",
      overridePaise: RS(100_000),
    });
    expect(d.required).toBe(false);
    expect(d.overridden).toBe(true);
  });

  it("ignores a zero or negative override rather than disabling the check", () => {
    // A blank field must not silently switch the requirement off.
    const d = ewayBillRequired({
      consignmentValuePaise: RS(60_000),
      fromStateCode: "19",
      toStateCode: "19",
      overridePaise: 0,
    });
    expect(d.overridden).toBe(false);
    expect(d.required).toBe(true);
  });

  it("treats intra-state as same code regardless of zero padding", () => {
    const d = ewayBillRequired({ consignmentValuePaise: RS(60_000), fromStateCode: "07", toStateCode: "07" });
    expect(d.interState).toBe(false);
  });
});

describe("validityDays — 1 day per 200 km", () => {
  it.each([
    [1, 1],
    [200, 1],
    [201, 2],
    [400, 2],
    [401, 3],
    [1000, 5],
  ])("%i km → %i day(s)", (km, days) => {
    expect(validityDays(km)).toBe(days);
  });

  it("gives over-dimensional cargo 1 day per 20 km", () => {
    expect(validityDays(20, true)).toBe(1);
    expect(validityDays(21, true)).toBe(2);
    expect(validityDays(200, true)).toBe(10);
  });

  it("never returns less than a day, even for a missing distance", () => {
    expect(validityDays(0)).toBe(1);
    expect(validityDays(-5)).toBe(1);
    expect(validityDays(Number.NaN)).toBe(1);
  });
});

describe("validUntil", () => {
  it("expires at the end of the final day", () => {
    const partB = new Date("2026-08-04T10:00:00Z");
    const end = validUntil(partB, 150); // 1 day
    expect(end.toISOString()).toBe("2026-08-05T23:59:59.999Z");
  });

  it("adds a day for every extra 200 km", () => {
    const partB = new Date("2026-08-04T10:00:00Z");
    expect(validUntil(partB, 450).toISOString()).toBe("2026-08-07T23:59:59.999Z"); // 3 days
  });

  it("runs from Part-B, not from when the consignment was entered", () => {
    // Same distance, Part-B a day later → expiry a day later. The clock starts when the
    // vehicle is known, per Rule 138(10).
    const a = validUntil(new Date("2026-08-04T10:00:00Z"), 100);
    const b = validUntil(new Date("2026-08-05T10:00:00Z"), 100);
    expect(b.getTime()).toBeGreaterThan(a.getTime());
  });
});

describe("document age and cancellation windows", () => {
  it("blocks documents older than 180 days", () => {
    const now = new Date("2026-08-04T00:00:00Z");
    const fresh = new Date("2026-06-01T00:00:00Z");
    const stale = new Date("2026-01-01T00:00:00Z");
    expect(documentTooOld(fresh, now)).toBe(false);
    expect(documentTooOld(stale, now)).toBe(true);
    expect(MAX_DOCUMENT_AGE_DAYS).toBe(180);
  });

  it("allows cancellation only within 24 hours", () => {
    const gen = new Date("2026-08-04T10:00:00Z");
    expect(withinCancelWindow(gen, new Date("2026-08-04T20:00:00Z"))).toBe(true);
    expect(withinCancelWindow(gen, new Date("2026-08-05T09:59:00Z"))).toBe(true);
    expect(withinCancelWindow(gen, new Date("2026-08-05T10:01:00Z"))).toBe(false);
  });
});

describe("UQC mapping", () => {
  it("maps our shop units onto valid codes", () => {
    expect(toUqc("kg")).toBe("KGS");
    expect(toUqc("g")).toBe("GMS");
    expect(toUqc("l")).toBe("LTR");
    expect(toUqc("m")).toBe("MTR");
    expect(toUqc("sqft")).toBe("SQF");
    expect(toUqc("roll")).toBe("ROL");
    expect(toUqc("bag")).toBe("BAG");
    expect(toUqc("box")).toBe("BOX");
    expect(toUqc("pcs")).toBe("PCS");
  });

  it("maps hardware vernacular to pieces, which is what it means", () => {
    // A "coil" of wire and a "bucket" of paint are counted as units, so NOS is truthful.
    expect(toUqc("coil")).toBe("NOS");
    expect(toUqc("bucket")).toBe("NOS");
    expect(toUqc("tin")).toBe("NOS");
  });

  it("ignores case and punctuation", () => {
    expect(toUqc("SQ-FT")).toBe("SQF");
    expect(toUqc("Sq Ft")).toBe("SQF");
    expect(toUqc("KGS")).toBe("KGS");
  });

  it("falls back to OTH rather than guessing", () => {
    expect(toUqc("ft")).toBe("OTH"); // no linear-feet UQC exists
    expect(toUqc("zzz")).toBe("OTH");
    expect(hasExactUqc("ft")).toBe(false);
    expect(hasExactUqc("kg")).toBe(true);
  });

  it("falls back to the unit NAME when the code is unknown", () => {
    expect(toUqc("xx", "Kilogram")).toBe("KGS");
  });

  it("only ever emits a code from the official list", () => {
    const valid = new Set(UQC_CODES.map((u) => u.code));
    for (const probe of ["kg", "coil", "ft", "zzz", "", "BOX", "sq ft"]) {
      expect(valid.has(toUqc(probe)), probe).toBe(true);
    }
  });
});
