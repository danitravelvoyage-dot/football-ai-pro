/**
 * A small in-process stand-in for the Supabase query builder. It implements only the operators the
 * AI stores use (eq, in, or with the keyset pattern, order, limit, range, head counts) and applies
 * the same project row ceiling PostgREST enforces. It lets store logic run without a network.
 */
type Row = Record<string, unknown>;

export interface FakeOptions {
  /** Rows the server returns per request at most (the project default is 1000). */
  maxRows?: number;
}

const KEYSET = /^created_at\.(lt|gt)\.(\S+?),and\(created_at\.eq\.(\S+?),id\.(lt|gt)\.(\S+?)\)$/;

function keysetPredicate(expr: string): (r: Row) => boolean {
  const m = KEYSET.exec(expr);
  if (!m) throw new Error(`Fake does not support filter: ${expr}`);
  const [, op1, ts, tsEq, op2, id] = m;
  const cmp = (a: string, b: string, op: string) => (op === "lt" ? a < b : a > b);
  return (r) => {
    const created = String(r.created_at);
    return cmp(created, ts, op1) || (created === tsEq && cmp(String(r.id), id, op2));
  };
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private lim: number | null = null;
  private window: [number, number] | null = null;
  private head = false;
  private single = false;

  constructor(
    private readonly rows: Row[],
    private readonly options: FakeOptions,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.head = true;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  or(expr: string) {
    this.filters.push(keysetPredicate(expr));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private run(): { data: unknown; error: null; count: number | null } {
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    const total = matched.length;
    matched = [...matched].sort((a, b) => {
      for (const { col, asc } of this.orders) {
        const av = String(a[col]);
        const bv = String(b[col]);
        if (av !== bv) return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    if (this.head) return { data: null, error: null, count: total };
    if (this.window) matched = matched.slice(this.window[0], this.window[1] + 1);
    if (this.lim !== null) matched = matched.slice(0, this.lim);
    if (this.options.maxRows !== undefined) matched = matched.slice(0, this.options.maxRows);
    if (this.single) return { data: matched[0] ?? null, error: null, count: null };
    return { data: matched, error: null, count: null };
  }

  then<R1, R2>(onfulfilled?: (v: { data: unknown; error: null; count: number | null }) => R1 | PromiseLike<R1>, onrejected?: (e: unknown) => R2 | PromiseLike<R2>) {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(tables: Record<string, Row[]>, options: FakeOptions = {}) {
  return {
    from(table: string) {
      return new FakeQuery(tables[table] ?? [], options);
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}
