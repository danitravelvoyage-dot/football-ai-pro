import { describe, it, expect } from "vitest";
import { csvCell } from "@/lib/csv";

describe("CSV export: spreadsheet formula protection", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=cmd", "\r=cmd"])("neutralises a cell starting with %j", (value) => {
    const cell = csvCell(value);
    expect(cell.startsWith('"\'')).toBe(true);
  });

  it("quotes ordinary text and doubles inner quotes", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("leaves a normal value unchanged apart from the quotes", () => {
    expect(csvCell("GTA-2611-ABC123")).toBe('"GTA-2611-ABC123"');
  });

  it("writes an empty cell for null and undefined", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("keeps numbers as text, so a formula cannot start from one", () => {
    expect(csvCell(-5)).toBe("\"'-5\"");
  });
});
