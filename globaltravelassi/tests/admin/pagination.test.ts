import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_SIZE, pageHref, pageInfo, pageRange, parsePage, searchTerm } from "@/lib/pagination";

describe("admin pagination", () => {
  it("parses only positive whole page numbers, and caps very large ones", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["4", "9"])).toBe(4);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("1e3")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("999999")).toBe(10_000);
  });

  it("computes the database range for a page", () => {
    expect(pageRange(1)).toEqual({ from: 0, to: ADMIN_PAGE_SIZE - 1 });
    expect(pageRange(3, 10)).toEqual({ from: 20, to: 29 });
  });

  it("describes the rows shown and the number of pages", () => {
    expect(pageInfo(1, 0, 0)).toMatchObject({ pages: 1, from: 0, to: 0 });
    expect(pageInfo(2, 60, 25)).toMatchObject({ pages: 3, from: 26, to: 50 });
    expect(pageInfo(3, 60, 10)).toMatchObject({ pages: 3, from: 51, to: 60 });
  });

  it("keeps the filters in page links and drops empty ones", () => {
    expect(pageHref("/en/admin/applications", { status: "new", q: "", page: "4" }, 2)).toBe("/en/admin/applications?status=new&page=2");
    expect(pageHref("/en/admin/applications", { source: "tiktok" }, 1)).toBe("/en/admin/applications?source=tiktok");
    expect(pageHref("/ar/admin/customers", {}, 1)).toBe("/ar/admin/customers");
  });

  it("cleans search terms so they cannot change the database filter", () => {
    expect(searchTerm("  amina  ")).toBe("amina");
    expect(searchTerm("a,b)or(c")).toBe("a b or c");
    expect(searchTerm("x%y*z:w\\v\"q'")).toBe("x y z w v q");
    expect(searchTerm("a".repeat(150))).toHaveLength(100);
    expect(searchTerm(undefined)).toBe("");
  });
});
