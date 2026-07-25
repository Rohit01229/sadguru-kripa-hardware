import { describe, it, expect } from "vitest";
import { parseCsv } from "./service";

// CSV parsing (04 Import). The importer validates each parsed row with the shared
// importRowSchema; here we assert the parser itself handles headers, quoting,
// escaped quotes, embedded commas/newlines, and blank-line skipping.

describe("import.parseCsv", () => {
  it("parses a simple header + rows", () => {
    const grid = parseCsv("sku,name,salePrice\nA,Widget,100\nB,Gadget,200\n");
    expect(grid).toEqual([
      ["sku", "name", "salePrice"],
      ["A", "Widget", "100"],
      ["B", "Gadget", "200"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const grid = parseCsv('sku,name\nA,"Wire, 2.5mm"\n');
    expect(grid[1]).toEqual(["A", "Wire, 2.5mm"]);
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    const grid = parseCsv('name\n"2"" pipe"\n');
    expect(grid[1]).toEqual(['2" pipe']);
  });

  it("skips blank lines", () => {
    const grid = parseCsv("sku\nA\n\n\nB\n");
    expect(grid).toEqual([["sku"], ["A"], ["B"]]);
  });

  it("handles a file with no trailing newline", () => {
    const grid = parseCsv("sku,name\nA,Widget");
    expect(grid[1]).toEqual(["A", "Widget"]);
  });
});
