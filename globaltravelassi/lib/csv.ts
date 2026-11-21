/**
 * Spreadsheet cells that start with these characters are read as formulas by Excel and Google Sheets. A leading quote
 * makes them text. The tab and carriage return are included, because some programs also start a formula after them.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-safe, quoted, with inner quotes doubled. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
