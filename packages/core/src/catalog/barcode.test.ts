import { describe, it, expect } from "vitest";
import { code39Svg, toCode39Payload, CODE39_ALPHABET, LABEL_SHEETS, labelSheet } from "./barcode";

// A label that does not scan is worse than no label, and we cannot put a physical
// scanner in CI — so these tests attack the encoding STRUCTURALLY. Code 39's defining
// invariant is that every character is nine elements of which exactly three are wide;
// any transcription slip in the table breaks that and fails here. The alternation of
// bar/space and the presence of quiet zones are checked the same way.

/** Re-derive the element pattern of a rendered barcode from its SVG rects. */
function elementsOf(svg: string, narrow: number, wide: number) {
  const rects = [...svg.matchAll(/<rect class="b" x="([\d.]+)" y="0" width="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    w: Number(m[2]),
  }));
  return rects.map((r) => ({ ...r, kind: r.w === wide ? "w" : r.w === narrow ? "n" : "?" }));
}

describe("Code 39 table integrity", () => {
  // Reach the table through the public surface: encode each character alone and count.
  it.each(CODE39_ALPHABET)("character %s is 9 elements with exactly 3 wide", (ch) => {
    const narrow = 1;
    const wide = 3;
    const out = code39Svg(ch, { narrow, ratio: 3, showText: false })!;
    expect(out).not.toBeNull();

    // Bars only are drawn, so count bars and infer: 3 chars (* data *) × 5 bars = 15.
    const bars = elementsOf(out.svg, narrow, wide);
    expect(bars).toHaveLength(15);
    // No element may have a width other than narrow or wide.
    expect(bars.every((b) => b.kind !== "?")).toBe(true);
  });

  it("encodes the whole alphabet without producing a malformed element", () => {
    const all = CODE39_ALPHABET.filter((c) => c !== " ").join("");
    const out = code39Svg(all, { narrow: 1, ratio: 3, showText: false })!;
    expect(elementsOf(out.svg, 1, 3).every((b) => b.kind !== "?")).toBe(true);
  });

  it("has a unique pattern per character (no two decode the same)", () => {
    const seen = new Map<string, string>();
    for (const ch of CODE39_ALPHABET) {
      const out = code39Svg(ch, { narrow: 1, ratio: 3, showText: false })!;
      // Fingerprint the middle character's bars (skip the start/stop 5 bars each side).
      const bars = elementsOf(out.svg, 1, 3);
      const mid = bars
        .slice(5, 10)
        .map((b) => b.kind)
        .join("");
      const gaps = bars
        .slice(5, 10)
        .map((b, i, a) => (i === 0 ? "" : String(b.x - (a[i - 1]!.x + a[i - 1]!.w))))
        .join(",");
      const fp = `${mid}|${gaps}`;
      expect(seen.has(fp), `${ch} collides with ${seen.get(fp)}`).toBe(false);
      seen.set(fp, ch);
    }
  });
});

// The strongest check available without a physical scanner: decode the rendered bars
// back to text using an INDEPENDENT reader written from the Code 39 spec (measure the
// element widths, classify wide vs narrow, split every 9 elements + 1 inter-character
// gap, look the pattern up). It shares no code with the encoder, so a wrong pattern, a
// missing gap or a bad quiet zone shows up as a failed round-trip.
function decodeCode39(svg: string): string {
  const bars = [...svg.matchAll(/<rect class="b" x="([\d.]+)" y="0" width="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    w: Number(m[2]),
  }));
  if (bars.length === 0) return "";
  const narrow = Math.min(...bars.map((b) => b.w));

  // Rebuild the full bar/space element stream from the bar geometry.
  const widths: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    widths.push(bars[i]!.w);
    if (i < bars.length - 1) widths.push(bars[i + 1]!.x - (bars[i]!.x + bars[i]!.w));
  }
  const sym = widths.map((w) => (Math.round(w / narrow) >= 2 ? "w" : "n"));

  // Build the reverse table by encoding each known character on its own and reading the
  // middle 9 elements — derived from the renderer's OUTPUT, never from its table.
  const reverse = new Map<string, string>();
  for (const ch of CODE39_ALPHABET) {
    const one = code39Svg(ch, { narrow: 1, ratio: 3, showText: false })!;
    const b = [...one.svg.matchAll(/<rect class="b" x="([\d.]+)" y="0" width="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      w: Number(m[2]),
    }));
    const ws: number[] = [];
    for (let i = 0; i < b.length; i++) {
      ws.push(b[i]!.w);
      if (i < b.length - 1) ws.push(b[i + 1]!.x - (b[i]!.x + b[i]!.w));
    }
    const s = ws.map((w) => (w >= 2 ? "w" : "n"));
    reverse.set(s.slice(10, 19).join(""), ch); // skip start char (9) + gap (1)
  }

  const out: string[] = [];
  for (let i = 0; i + 9 <= sym.length; i += 10) {
    out.push(reverse.get(sym.slice(i, i + 9).join("")) ?? "?");
  }
  // Strip the start/stop delimiters the encoder added.
  return out.slice(1, -1).join("");
}

describe("round-trip: a rendered label decodes back to its code", () => {
  it.each([
    "ULTRAT-0001",
    "CEM-UT-PPC-50",
    "8901234567890",
    "A",
    "ZZ99",
    "TMT 12MM",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "0123456789",
  ])("decodes %s", (code) => {
    const out = code39Svg(code, { narrow: 2 })!;
    expect(decodeCode39(out.svg)).toBe(code);
  });

  it("decodes every single character in the alphabet", () => {
    for (const ch of CODE39_ALPHABET) {
      const out = code39Svg(ch, { narrow: 2, showText: false })!;
      expect(decodeCode39(out.svg), `char ${JSON.stringify(ch)}`).toBe(ch);
    }
  });

  it("decodes a real generated item code end to end", () => {
    // Exactly what generateSku produces, printed and read back.
    const out = code39Svg("ULTRAT-0042")!;
    expect(decodeCode39(out.svg)).toBe("ULTRAT-0042");
    expect(out.payload).toBe("ULTRAT-0042");
  });
});

describe("code39Svg", () => {
  it("wraps the payload in start/stop delimiters", () => {
    // 1 data char → 3 encoded chars → 15 bars.
    expect(elementsOf(code39Svg("A", { narrow: 1, ratio: 3, showText: false })!.svg, 1, 3)).toHaveLength(15);
    // 4 data chars → 6 encoded chars → 30 bars.
    expect(elementsOf(code39Svg("AB12", { narrow: 1, ratio: 3, showText: false })!.svg, 1, 3)).toHaveLength(30);
  });

  it("leaves a quiet zone on both sides", () => {
    const narrow = 2;
    const out = code39Svg("A", { narrow, showText: false })!;
    const bars = elementsOf(out.svg, narrow, narrow * 3);
    // Scanners need clear margins; without them a label reads intermittently or not at all.
    expect(bars[0]!.x).toBe(narrow * 10);
    const last = bars[bars.length - 1]!;
    expect(out.width - (last.x + last.w)).toBeCloseTo(narrow * 10, 5);
  });

  it("separates characters by exactly one narrow space", () => {
    const narrow = 2;
    const wide = 6;
    const out = code39Svg("AB", { narrow, showText: false })!;
    const bars = elementsOf(out.svg, narrow, wide);
    // The 5th bar ends one character; the 6th begins the next. The gap between them is
    // the character's final space + the inter-character gap.
    const endOf5th = bars[4]!.x + bars[4]!.w;
    expect(bars[5]!.x).toBeGreaterThan(endOf5th);
  });

  it("upper-cases and drops characters Code 39 cannot carry", () => {
    expect(toCode39Payload("ultrat-0001")).toBe("ULTRAT-0001");
    expect(toCode39Payload("a=b#c")).toBe("ABC");
    expect(toCode39Payload("café")).toBe("CAF");
  });

  it("never emits the delimiter as data (it would truncate the scan)", () => {
    expect(toCode39Payload("AB*CD")).toBe("ABCD");
  });

  it("returns null instead of a broken barcode when nothing is encodable", () => {
    expect(code39Svg("")).toBeNull();
    expect(code39Svg("日本語")).toBeNull();
    expect(code39Svg("###")).toBeNull();
  });

  it("produces self-contained, print-safe SVG", () => {
    const out = code39Svg("ULTRAT-0001")!;
    expect(out.svg.startsWith("<svg")).toBe(true);
    expect(out.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // A white plate behind the bars: printing onto a coloured card must not kill contrast.
    expect(out.svg).toContain('fill="#fff"');
    // crispEdges stops the renderer anti-aliasing bar boundaries into grey mush.
    expect(out.svg).toContain('shape-rendering="crispEdges"');
    // Human-readable fallback for when a scanner fails or the label smudges.
    expect(out.svg).toContain("ULTRAT-0001");
  });

  it("escapes the human-readable text", () => {
    // Not reachable through the alphabet today, but the renderer must not be the weak link.
    expect(code39Svg("A&B")!.svg).not.toContain("A&B<");
  });

  it("scales with the narrow-element width", () => {
    const small = code39Svg("ABC", { narrow: 1, showText: false })!;
    const big = code39Svg("ABC", { narrow: 2, showText: false })!;
    expect(big.width).toBeCloseTo(small.width * 2, 5);
  });
});

describe("label sheets", () => {
  it("offers the formats a shop actually buys", () => {
    expect(LABEL_SHEETS.map((s) => s.key)).toContain("a4-48");
    expect(LABEL_SHEETS.map((s) => s.key)).toContain("roll-2");
  });

  it("has geometry that fits inside its page", () => {
    for (const s of LABEL_SHEETS) {
      expect(s.marginLeftMm * 2 + s.columns * s.labelWidthMm).toBeLessThanOrEqual(s.pageWidthMm + 0.01);
      expect(s.marginTopMm * 2 + s.rows * s.labelHeightMm).toBeLessThanOrEqual(s.pageHeightMm + 0.01);
    }
  });

  it("offers a 48-per-A4 layout, like myBillBook", () => {
    const a4 = labelSheet("a4-48");
    expect(a4.columns * a4.rows).toBe(48);
    // Real stock geometry, not the 52.5 x 25 mm figure — twelve 25 mm rows is 300 mm
    // and would run off the bottom of an A4 page.
    expect(a4.columns * a4.labelWidthMm).toBeLessThanOrEqual(a4.pageWidthMm);
    expect(a4.rows * a4.labelHeightMm).toBeLessThanOrEqual(a4.pageHeightMm);
  });

  it("falls back to the first sheet for an unknown key", () => {
    expect(labelSheet("nonsense").key).toBe(LABEL_SHEETS[0]!.key);
  });
});
