// Barcode generation for shop-printed labels (19 §12).
//
// SYMBOLOGY: **Code 39**, deliberately.
//   - It is the classic inventory/label symbology and every handheld scanner reads it
//     out of the box, with no configuration.
//   - It is **self-checking** — each character carries its own structure, so a
//     misprinted or partly-smudged bar fails to decode rather than decoding wrongly.
//     For a shop label that is the property that matters: a barcode that silently reads
//     as the wrong item would put the wrong price on a bill.
//   - Its table is 44 entries, small enough to hold correct and to verify structurally
//     in tests (every character must be 9 elements with exactly 3 wide) — which is why
//     it is preferred here over Code 128, whose 107-entry table is far easier to get
//     subtly wrong, and wrong means unscannable labels.
//
// Trade-off, stated plainly: Code 39 encodes only 0-9, A-Z and a few symbols, and is
// less dense than Code 128, so a long code makes a wide label. Our item codes are short
// and uppercase-alphanumeric by construction (`generateSku` → "ULTRAT-0001"), so this
// costs us nothing today. If a shop ever needs full ASCII or a true retail GTIN, EAN-13
// or Code 128 can be added alongside — the renderer below is symbology-agnostic.
//
// No dependency: this emits plain SVG, which prints crisply at any size and needs no
// canvas, no font and no runtime library.

/**
 * Code 39 patterns. Nine elements per character, alternating **bar, space, bar, …**
 * starting with a bar; `w` = wide, `n` = narrow. Exactly three elements are wide in
 * every valid pattern — the invariant the tests assert.
 */
const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn", // start / stop delimiter — never part of the data
};

/** The characters Code 39 can represent (excluding the `*` delimiter). */
export const CODE39_ALPHABET = Object.keys(CODE39).filter((c) => c !== "*");

/**
 * Normalise arbitrary text into something Code 39 can carry: upper-case, and drop
 * anything outside the alphabet. Returns "" when nothing usable remains, which callers
 * treat as "this item has no printable barcode" rather than printing a broken one.
 */
export function toCode39Payload(raw: string): string {
  return [...raw.toUpperCase()].filter((ch) => ch in CODE39 && ch !== "*").join("");
}

export interface BarcodeSvgOptions {
  /** Width of a narrow element, in SVG user units (≈ px at 1:1). */
  narrow?: number;
  /** Wide:narrow ratio. The spec allows 2.0–3.0; 3 scans most forgivingly on cheap printers. */
  ratio?: number;
  /** Bar height in user units. */
  height?: number;
  /** Print the human-readable code beneath the bars (always do this on a shop label). */
  showText?: boolean;
}

export interface BarcodeSvg {
  /** Complete <svg> markup, self-contained and print-safe. */
  svg: string;
  /** Intrinsic width in user units, so a caller can scale or centre it. */
  width: number;
  height: number;
  /** The normalised payload actually encoded (may differ from the input). */
  payload: string;
}

/**
 * Render `text` as a Code 39 barcode SVG.
 *
 * Structure: `*` start, the payload, `*` stop, with a one-narrow-space gap between
 * every character. Quiet zones (10 narrow widths each side) are included — scanners
 * need them, and leaving them out is the most common reason a printed label fails.
 * Returns null when the text has no encodable characters.
 */
export function code39Svg(text: string, opts: BarcodeSvgOptions = {}): BarcodeSvg | null {
  const payload = toCode39Payload(text);
  if (!payload) return null;

  const narrow = opts.narrow ?? 2;
  const ratio = opts.ratio ?? 3;
  const wide = narrow * ratio;
  const height = opts.height ?? 60;
  const showText = opts.showText ?? true;
  const quiet = narrow * 10;
  const textGap = showText ? 14 : 0;

  const chars = ["*", ...payload, "*"];
  const rects: string[] = [];
  let x = quiet;

  chars.forEach((ch, ci) => {
    const pattern = CODE39[ch]!;
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern[i] === "w" ? wide : narrow;
      // Even indices are bars, odd are spaces — only bars are drawn.
      if (i % 2 === 0) {
        // class="b" marks a BAR specifically, so the white backing plate below is never
        // mistaken for one (by a stylesheet, or by the tests that re-derive the pattern).
        rects.push(`<rect class="b" x="${round(x)}" y="0" width="${round(w)}" height="${height}"/>`);
      }
      x += w;
    }
    // One narrow space between characters (not after the final stop character).
    if (ci < chars.length - 1) x += narrow;
  });

  const total = round(x + quiet);
  const totalHeight = height + textGap;
  const label = showText
    ? `<text x="${total / 2}" y="${height + 11}" text-anchor="middle" font-family="monospace" font-size="11">${escapeXml(
        payload,
      )}</text>`
    : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${totalHeight}" ` +
    `viewBox="0 0 ${total} ${totalHeight}" shape-rendering="crispEdges" fill="#000">` +
    `<rect x="0" y="0" width="${total}" height="${totalHeight}" fill="#fff"/>` +
    rects.join("") +
    label +
    `</svg>`;

  return { svg, width: total, height: totalHeight, payload };
}

/** Trim float noise so the SVG stays small and diffable. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Label sheet geometry ─────────────────────────────────────────────────────
// Matching the formats a shop actually buys. myBillBook prints 48 to an A4 sheet
// (4 across, 52.5 × 25 mm) and 2 across on a label roll; those are the defaults here.

export interface LabelSheetSpec {
  key: string;
  name: string;
  /** Labels across the page. */
  columns: number;
  /** Labels down the page. */
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  pageWidthMm: number;
  /** Page height in mm; a roll is continuous, so this is one label pitch. */
  pageHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
}

export const LABEL_SHEETS: readonly LabelSheetSpec[] = [
  // Geometry follows the A4 label stock actually sold in shops (Avery L7654 / L7159
  // equivalents). Note this is NOT "4 × 12 at 52.5 × 25 mm": twelve 25 mm rows is
  // 300 mm, which does not fit A4's 297 mm — the sheet test below enforces that.
  {
    key: "a4-48",
    name: "A4 sheet — 48 labels (4 × 12, 45.7 × 21.2 mm)",
    columns: 4,
    rows: 12,
    labelWidthMm: 45.7,
    labelHeightMm: 21.2,
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginTopMm: 21.3,
    marginLeftMm: 13.6,
  },
  {
    key: "a4-24",
    name: "A4 sheet — 24 labels (3 × 8, 63.5 × 33.9 mm)",
    columns: 3,
    rows: 8,
    labelWidthMm: 63.5,
    labelHeightMm: 33.9,
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginTopMm: 12.9,
    marginLeftMm: 9.7,
  },
  {
    key: "roll-2",
    name: "Label roll — 2 across (50 × 25 mm)",
    columns: 2,
    rows: 1,
    labelWidthMm: 50,
    labelHeightMm: 25,
    pageWidthMm: 100,
    pageHeightMm: 25,
    marginTopMm: 0,
    marginLeftMm: 0,
  },
] as const;

export function labelSheet(key: string): LabelSheetSpec {
  return LABEL_SHEETS.find((s) => s.key === key) ?? LABEL_SHEETS[0]!;
}
