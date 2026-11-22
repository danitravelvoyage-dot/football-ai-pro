// TEST-ONLY fake of the Supabase HTTP API: Auth (current user) and the PostgREST subset that the admin and customer
// pages use. In-memory, synthetic data only (example.test addresses, placeholder numbers). It is NOT a database and does
// NOT enforce Row Level Security: customer isolation is tested against real Postgres rules in tests/db/rls.test.ts.
import http from "node:http";
import crypto from "node:crypto";

export const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
export const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000c1";
export const TOKENS = { admin: "qa-admin-token", customer: "qa-customer-token" };

const DAY = 86_400_000;

const SERVICES = [
  ["france-visa-appointment", "appointment", "France visa appointment assistance", "Rendez-vous visa France", "مواعيد تأشيرة فرنسا"],
  ["appointment-assistance", "appointment", "Visa appointment assistance", "Aide aux rendez-vous de visa", "المساعدة في مواعيد التأشيرة"],
  ["visa-consulting", "visa", "Visa consulting", "Conseil visa", "استشارات التأشيرة"],
  ["visa-file-assistance", "visa", "Visa application file assistance", "Aide au dossier de visa", "المساعدة في ملف التأشيرة"],
  ["e-visa", "e_visa", "E-visa services", "Visas électroniques", "التأشيرات الإلكترونية"],
  ["flight-booking", "booking", "Flight bookings", "Réservation de vols", "حجز الطيران"],
  ["hotel-booking", "booking", "Hotel bookings", "Réservation d’hôtels", "حجز الفنادق"],
  ["travel-itinerary", "itinerary", "Travel itineraries", "Itinéraires de voyage", "برامج السفر"],
  ["transit-airport", "transit", "Transit & airport consulting", "Transit et aéroport", "العبور والمطار"],
];

const STATUSES = ["new", "in_review", "documents_required", "submitted", "approved", "rejected", "completed", "cancelled"];
const SOURCES = ["tiktok", "instagram", "facebook", "google", "whatsapp", "direct", "other", null];
const LOCALES = ["ar", "fr", "en"];

/** Deterministic synthetic fixtures. `now` fixes every date, so runs are repeatable. */
export function fixtures(now = Date.now()) {
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const dateIn = (days) => new Date(now + days * DAY).toISOString().slice(0, 10);
  const profiles = [
    { id: ADMIN_ID, email: "owner-qa@example.test", full_name: "QA Owner", whatsapp: "", role: "admin", is_active: true, created_at: iso(400 * DAY) },
    { id: CUSTOMER_ID, email: "amina-qa@example.test", full_name: "Amina QA", whatsapp: "0000000001", role: "customer", is_active: true, created_at: iso(60 * DAY) },
  ];
  for (let i = 2; i <= 31; i++) {
    profiles.push({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, email: `customer${i}-qa@example.test`, full_name: `Customer ${i} QA`, whatsapp: `00000000${String(i).padStart(2, "0")}`, role: "customer", is_active: i % 9 !== 0, created_at: iso(i * DAY) });
  }
  const services = SERVICES.map(([slug, category, en, fr, ar], i) => ({
    id: `00000000-0000-4000-8000-00000000050${i}`, slug, category, title_en: en, title_fr: fr, title_ar: ar,
    description_en: `${en}.`, description_fr: `${fr}.`, description_ar: `${ar}.`, price: i === 4 ? 9000 : null, currency: "DZD", is_active: true, sort_order: i,
  }));
  const applications = [];
  for (let i = 1; i <= 30; i++) {
    const owner = i === 1 || i === 2 ? CUSTOMER_ID : profiles[1 + (i % 30)].id;
    const service = services[i % services.length];
    applications.push({
      id: `00000000-0000-4000-8000-0000000a${String(i).padStart(4, "0")}`,
      reference: `GTA-2611-QA${String(i).padStart(8, "0")}`,
      user_id: owner,
      service_id: i === 1 ? services[3].id : service.id,
      full_name: owner === CUSTOMER_ID ? "Amina QA" : `Customer ${1 + (i % 30)} QA`,
      email: owner === CUSTOMER_ID ? "amina-qa@example.test" : `customer${1 + (i % 30)}-qa@example.test`,
      whatsapp: `00000000${String(i).padStart(2, "0")}`,
      nationality: "DZ", country_of_residence: "DZ", destination_country: "FR",
      travel_date: i % 4 === 0 ? null : dateIn(i * 7 - 20),
      employment_status: "employed",
      previous_travel_history: i % 3 === 0 ? "Spain 2024" : "",
      additional_info: "",
      status: i === 1 ? "in_review" : STATUSES[i % STATUSES.length],
      source: null,
      locale: LOCALES[i % 3],
      lead_source: SOURCES[i % SOURCES.length],
      lead_source_detail: null,
      lead_source_corrected_at: null,
      customer_category: i % 5 === 0 ? "priority" : "standard",
      last_contacted_at: i % 2 === 0 ? iso(i * 3_600_000) : null,
      last_contact_channel: i % 2 === 0 ? "whatsapp" : null,
      created_at: iso(i * DAY),
      updated_at: iso(i * DAY),
    });
  }
  const first = applications[0].id;
  const documents = [
    { id: "00000000-0000-4000-8000-0000000d0001", application_id: first, user_id: CUSTOMER_ID, doc_type: "passport", storage_path: `${CUSTOMER_ID}/${first}/passport.pdf`, file_name: "passport.pdf", mime_type: "application/pdf", size_bytes: 120_000, verified: true, created_at: iso(DAY / 2) },
    { id: "00000000-0000-4000-8000-0000000d0002", application_id: first, user_id: CUSTOMER_ID, doc_type: "photo", storage_path: `${CUSTOMER_ID}/${first}/photo.jpg`, file_name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 40_000, verified: false, created_at: iso(DAY / 3) },
    { id: "00000000-0000-4000-8000-0000000d0003", application_id: applications[2].id, user_id: applications[2].user_id, doc_type: "passport", storage_path: "x/y/p.pdf", file_name: "p.pdf", mime_type: "application/pdf", size_bytes: 90_000, verified: false, created_at: iso(DAY) },
  ];
  const events = applications.map((a, i) => ({ id: crypto.randomUUID(), application_id: a.id, kind: "created", to_status: null, message: "", created_at: a.created_at, _order: i }));
  return {
    profiles,
    services,
    applications,
    documents,
    application_events: events,
    customer_application_events: events,
    application_notes: [{ id: crypto.randomUUID(), application_id: first, author_id: ADMIN_ID, body: "QA note: call after 18:00.", created_at: iso(DAY / 4) }],
    crm_activity: [{ id: crypto.randomUUID(), application_id: first, actor_id: ADMIN_ID, kind: "lead_recorded", detail: "tiktok", created_at: iso(DAY) }],
    customer_email_notifications: [
      { id: crypto.randomUUID(), kind: "application_received", status: "sent", recipient: "amina-qa@example.test", locale: "fr", attempts: 1, error_code: null, subject_id: first, created_at: iso(DAY), sent_at: iso(DAY), last_attempt_at: iso(DAY) },
      { id: crypto.randomUUID(), kind: "application_status_updated", status: "failed", recipient: "amina-qa@example.test", locale: "fr", attempts: 2, error_code: "timeout", subject_id: first, created_at: iso(DAY / 2), sent_at: null, last_attempt_at: iso(DAY / 2) },
    ],
  };
}

// Embedded resources the pages select (PostgREST resource embedding). one = many-to-one, many = one-to-many.
const RELATIONS = {
  applications: {
    services: { table: "services", local: "service_id", foreign: "id", one: true },
    profiles: { table: "profiles", local: "user_id", foreign: "id", one: true },
    documents: { table: "documents", local: "id", foreign: "application_id", one: false },
  },
};

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function project(row, select, table, tables) {
  if (!select || select === "*") return { ...row };
  const out = {};
  for (const token of splitTopLevel(select)) {
    const embed = /^([a-z_]+)(?:![a-z_]+)?\((.*)\)$/.exec(token);
    if (embed) {
      const rel = RELATIONS[table]?.[embed[1]];
      if (!rel) continue;
      const related = (tables[rel.table] ?? []).filter((r) => String(r[rel.foreign]) === String(row[rel.local]));
      out[embed[1]] = rel.one ? (related[0] ? project(related[0], embed[2], rel.table, tables) : null) : related.map((r) => project(r, embed[2], rel.table, tables));
    } else if (token === "*") {
      Object.assign(out, row);
    } else {
      out[token] = row[token];
    }
  }
  return out;
}

const likeToRegex = (pattern, flags) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, flags);
const unquote = (v) => v.replace(/^"(.*)"$/, "$1");

function matches(row, col, expr) {
  const negate = expr.startsWith("not.");
  const body = negate ? expr.slice(4) : expr;
  const dot = body.indexOf(".");
  const op = body.slice(0, dot);
  const value = body.slice(dot + 1);
  const cell = row[col];
  let ok;
  switch (op) {
    case "eq": ok = String(cell) === value; break;
    case "neq": ok = String(cell) !== value; break;
    case "gt": ok = cell != null && String(cell) > value; break;
    case "gte": ok = cell != null && String(cell) >= value; break;
    case "lt": ok = cell != null && String(cell) < value; break;
    case "lte": ok = cell != null && String(cell) <= value; break;
    case "is": ok = value === "null" ? cell == null : String(cell) === value; break;
    case "in": ok = value.slice(1, -1).split(",").map(unquote).includes(String(cell)); break;
    case "like": ok = cell != null && likeToRegex(value, "").test(String(cell)); break;
    case "ilike": ok = cell != null && likeToRegex(value, "i").test(String(cell)); break;
    default: throw new Error(`fake supabase: unsupported operator ${op}`);
  }
  return negate ? !ok : ok;
}

const CONTROL = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function filterRows(rows, params) {
  let out = rows;
  for (const [col, expr] of params) {
    if (CONTROL.has(col)) continue;
    if (col === "or") {
      const clauses = splitTopLevel(expr.slice(1, -1)).map((c) => {
        const i = c.indexOf(".");
        return [c.slice(0, i), c.slice(i + 1)];
      });
      out = out.filter((r) => clauses.some(([c, e]) => matches(r, c, e)));
      continue;
    }
    out = out.filter((r) => matches(r, col, expr));
  }
  const order = params.find(([c]) => c === "order");
  if (order) {
    const keys = order[1].split(",").map((k) => k.split("."));
    out = [...out].sort((a, b) => {
      for (const [col, dir] of keys) {
        const x = String(a[col] ?? "");
        const y = String(b[col] ?? "");
        if (x !== y) return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
      }
      return 0;
    });
  }
  return out;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/** Starts the fake on 127.0.0.1:port. Returns the URL, the live tables, the write log and a stop function. */
export function startFakeSupabase({ port, now = Date.now() }) {
  const state = { tables: fixtures(now), writes: [] };
  const users = {
    [TOKENS.admin]: { id: ADMIN_ID, email: "owner-qa@example.test" },
    [TOKENS.customer]: { id: CUSTOMER_ID, email: "amina-qa@example.test" },
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const url = new URL(req.url, "http://fake");
        const path = url.pathname;
        const params = [...url.searchParams.entries()];

        if (path === "/auth/v1/user") {
          const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
          const user = users[token];
          if (!user) return send(res, 401, { message: "invalid JWT" });
          return send(res, 200, { ...user, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date(now).toISOString() });
        }
        if (path.startsWith("/auth/v1/")) return send(res, 200, {});
        if (path.startsWith("/storage/v1/")) return send(res, 200, { signedURL: "/qa-file" });
        if (path.startsWith("/rest/v1/rpc/")) {
          state.writes.push({ table: `rpc:${path.split("/").pop()}`, method: "POST" });
          return send(res, 200, []);
        }
        if (!path.startsWith("/rest/v1/")) return send(res, 404, { message: "not found" });

        const table = path.slice("/rest/v1/".length);
        const rows = state.tables[table] ?? (state.tables[table] = []);
        const select = url.searchParams.get("select") ?? "*";
        const prefer = String(req.headers.prefer ?? "");
        const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");

        if (req.method === "GET" || req.method === "HEAD") {
          const filtered = filterRows(rows, params);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : filtered.length;
          const page = filtered.slice(offset, offset + limit).map((r) => project(r, select, table, state.tables));
          const range = page.length ? `${offset}-${offset + page.length - 1}/${filtered.length}` : `*/${filtered.length}`;
          const headers = prefer.includes("count=exact") ? { "content-range": range } : { "content-range": range.replace(/\/\d+$/, "/*") };
          if (req.method === "HEAD") return send(res, 200, undefined, headers);
          if (single) {
            if (page.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
            return send(res, 200, page[0], headers);
          }
          return send(res, 200, page, headers);
        }

        const payload = raw ? JSON.parse(raw) : null;
        if (req.method === "POST") {
          const list = Array.isArray(payload) ? payload : [payload];
          const created = list.map((item) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...item }));
          rows.push(...created);
          state.writes.push({ table, method: "POST", count: created.length, rows: created });
          if (prefer.includes("return=representation")) {
            const shaped = created.map((r) => project(r, select, table, state.tables));
            return single ? send(res, 201, shaped[0]) : send(res, 201, shaped);
          }
          return send(res, 201, undefined);
        }
        if (req.method === "PATCH") {
          const targets = filterRows(rows, params);
          for (const r of targets) Object.assign(r, payload);
          state.writes.push({ table, method: "PATCH", count: targets.length, patch: payload });
          if (prefer.includes("return=representation")) {
            const shaped = targets.map((r) => project(r, select, table, state.tables));
            return single ? (shaped.length === 1 ? send(res, 200, shaped[0]) : send(res, 406, { code: "PGRST116" })) : send(res, 200, shaped);
          }
          return send(res, 204, undefined);
        }
        if (req.method === "DELETE") return send(res, 403, { message: "delete is not permitted in QA fixtures" });
        return send(res, 405, { message: "method not allowed" });
      } catch (error) {
        return send(res, 500, { message: `fake supabase error: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${port}`, state, stop: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
