import { describe, it, expect } from "vitest";
import { toPaise, fromPaise, roundToRupee } from "./money";

describe("money", () => {
  it("converts rupees to integer paise", () => {
    expect(toPaise("12.34")).toBe(1234);
    expect(toPaise(0.1)).toBe(10);
  });
  it("converts paise back to rupees", () => {
    expect(fromPaise(1234).toString()).toBe("12.34");
  });
  it("rounds to the nearest rupee (half up)", () => {
    expect(roundToRupee("12.4").toString()).toBe("12");
    expect(roundToRupee("12.5").toString()).toBe("13");
  });
});
