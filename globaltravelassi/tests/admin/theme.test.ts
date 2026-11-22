import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import config from "@/tailwind.config";
import { parseAdminTheme } from "@/lib/admin-theme";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const darkBlock = css.slice(css.indexOf('.admin-theme[data-theme="dark"] {'), css.indexOf("}", css.indexOf('.admin-theme[data-theme="dark"] {')));

function rgbOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function variable(block: string, name: string): string | null {
  const match = new RegExp(`--${name}:\\s*([0-9 ]+);`).exec(block);
  return match ? match[1].trim() : null;
}

describe("admin theme", () => {
  it("leaves the public site unchanged: every role variable defaults to the exact navy palette", () => {
    const navy = (config.theme?.extend?.colors as Record<string, Record<string, string>>).navy;
    for (const [shade, hex] of Object.entries(navy)) {
      for (const role of ["bg", "text", "line"]) {
        expect(variable(rootBlock, `navy-${role}-${shade}`), `${role}-${shade}`).toBe(rgbOf(hex));
      }
    }
    expect(variable(rootBlock, "surface")).toBe("255 255 255");
  });

  it("the dark theme keeps the darkest background and the darkest text unchanged", () => {
    // Hero headers (bg-navy-950 with white or gold text) and gold buttons (text-navy-950) must keep their contrast.
    expect(variable(darkBlock, "navy-bg-950")).toBeNull();
    expect(variable(darkBlock, "navy-text-950")).toBeNull();
    expect(variable(darkBlock, "surface")).not.toBeNull();
  });

  it("is scoped to the admin wrapper, never the whole page", () => {
    expect(css).not.toMatch(/(^|\n)\s*\[data-theme="dark"\]/);
    expect(css).not.toMatch(/html\[data-theme/);
  });

  it("reads the preference cookie safely: only 'dark' selects the dark theme", () => {
    expect(parseAdminTheme("dark")).toBe("dark");
    expect(parseAdminTheme("light")).toBe("light");
    expect(parseAdminTheme(undefined)).toBe("light");
    expect(parseAdminTheme("DARK")).toBe("light");
    expect(parseAdminTheme("<script>")).toBe("light");
  });
});
