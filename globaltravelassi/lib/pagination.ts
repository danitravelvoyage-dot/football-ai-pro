/** Page-based pagination for admin lists. Pages are 1-based; anything invalid becomes page 1. */

export const ADMIN_PAGE_SIZE = 25;
const MAX_PAGE = 10_000;

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  /** 1-based position of the first and last row shown, or 0 when the page is empty. */
  from: number;
  to: number;
}

export function parsePage(raw: string | string[] | undefined | null): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  const page = Number(value);
  return page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/** Row range for a database query: zero-based and inclusive, as PostgREST's range() expects. */
export function pageRange(page: number, pageSize = ADMIN_PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageInfo(page: number, total: number, rowsOnPage: number, pageSize = ADMIN_PAGE_SIZE): PageInfo {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = rowsOnPage > 0 ? (page - 1) * pageSize + 1 : 0;
  return { page, pageSize, total, pages, from, to: rowsOnPage > 0 ? from + rowsOnPage - 1 : 0 };
}

/** Link to another page of the same list, keeping every filter that is set. */
export function pageHref(basePath: string, params: Record<string, string | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** Escapes a search term for a PostgREST ilike filter inside or(): drops the characters that would change the filter. */
export function searchTerm(raw: string | undefined | null): string {
  return (raw ?? "").trim().slice(0, 100).replace(/[%,()*\\:"']/g, " ").replace(/\s+/g, " ").trim();
}
