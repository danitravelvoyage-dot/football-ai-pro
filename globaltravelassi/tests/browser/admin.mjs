// Signed-in browser test of the admin dashboard and the customer request page, against a TEST-ONLY fake of the
// Supabase API (tests/browser/fake-supabase.mjs) with synthetic data. No real database, account or customer data.
//
//   npm run test:admin-browser             builds a separate copy into .next-qa (about 2-3 minutes), then tests it
//   npm run test:admin-browser -- --reuse  reuses an existing .next-qa build
//
// The normal build in .next is never touched. Screenshots go to $ADMIN_QA_SHOTS or the system temp folder.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_ID, CUSTOMER_ID, TOKENS, startFakeSupabase } from "./fake-supabase.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FAKE_PORT = 54398; // Fixed: the Supabase URL is built into the app at build time.
const APP_PORT = 3311;
const BASE = `http://localhost:${APP_PORT}`;
const DIST = ".next-qa";
const SHOTS = process.env.ADMIN_QA_SHOTS || join(tmpdir(), "gta-admin-qa");
const EXECUTABLE = "/opt/pw-browsers/chromium";
const FIRST = "00000000-0000-4000-8000-0000000a0001";

const ENV = {
  ...process.env,
  NEXT_DIST_DIR: DIST,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "qa-anon-key",
  NEXT_PUBLIC_SITE_URL: BASE,
  NEXT_PUBLIC_WHATSAPP_NUMBER: "000000000",
  NEXT_PUBLIC_CONTACT_EMAIL: "contact-qa@example.test",
  EMAIL_DELIVERY_ENABLED: "false",
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function run(args, label) {
  const nextBin = join(ROOT, "node_modules/next/dist/bin/next");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], { cwd: ROOT, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(`${label} failed (${code}):\n${log.slice(-2000)}`))));
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Server did not start: ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function sessionCookie(token, userId, email) {
  const session = {
    access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `${token}-refresh`, user: { id: userId, aud: "authenticated", role: "authenticated", email },
  };
  return { name: "sb-127-auth-token", value: encodeURIComponent(JSON.stringify(session)), domain: "localhost", path: "/" };
}

const SESSIONS = {
  admin: sessionCookie(TOKENS.admin, ADMIN_ID, "owner-qa@example.test"),
  customer: sessionCookie(TOKENS.customer, CUSTOMER_ID, "amina-qa@example.test"),
};

/** Opens a page with an optional session and theme. Collects page errors and content-security-policy reports. */
async function open(browser, path, { as = "admin", theme, width = 1366, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const cookies = [];
  if (as) cookies.push(SESSIONS[as]);
  if (theme) cookies.push({ name: "gta_admin_theme", value: theme, domain: "localhost", path: "/" });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  const problems = { errors: [], csp: [] };
  page.on("pageerror", (e) => problems.errors.push(e.message.slice(0, 160)));
  page.on("console", (m) => {
    const text = m.text();
    if (/content.security.policy/i.test(text)) problems.csp.push(text.slice(0, 160));
    else if (m.type() === "error" && !/Failed to load resource/.test(text)) problems.errors.push(text.slice(0, 160));
  });
  const response = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 });
  return { page, context, response, problems };
}

const rowCount = (page) => page.locator("table tbody tr").count();
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const rgb = (text) => (text.match(/\d+/g) ?? []).slice(0, 3).map(Number);

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fake = await startFakeSupabase({ port: FAKE_PORT });
  const reuse = process.argv.includes("--reuse") && existsSync(join(ROOT, DIST, "BUILD_ID"));
  if (!reuse) {
    console.log(`Building a QA copy into ${DIST} against the fake Supabase on port ${FAKE_PORT}...`);
    await run(["build"], "QA build");
  }
  const nextBin = join(ROOT, "node_modules/next/dist/bin/next");
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT)], { cwd: ROOT, env: ENV, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const browser = await chromium.launch(existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
  const allCsp = [];

  try {
    await waitFor(`${BASE}/en`);

    // ---- Access control ------------------------------------------------------------------------------------
    const anon = await fetch(`${BASE}/en/admin`, { redirect: "manual" });
    check("an anonymous visitor is sent to sign-in", anon.status >= 300 && anon.status < 400 && (anon.headers.get("location") ?? "").includes("/en/auth/login"), `status ${anon.status}`);

    {
      const { page, context } = await open(browser, "/en/admin", { as: "customer" });
      const url = page.url();
      check("a customer cannot open the admin area", url.includes("/en/dashboard") && url.includes("error=denied") && !(await bodyText(page)).includes("Lead qualification"), url.replace(BASE, ""));
      await context.close();
    }

    // ---- Every launch admin page, three languages ------------------------------------------------------------
    for (const locale of ["en", "fr", "ar"]) {
      const bad = [];
      for (const path of ["/admin", "/admin/applications", `/admin/applications/${FIRST}`, "/admin/customers", "/admin/services", "/admin/emails", "/admin/reports", "/admin/command-center"]) {
        const { page, context, response, problems } = await open(browser, `/${locale}${path}`);
        const dir = await page.evaluate(() => document.documentElement.dir);
        allCsp.push(...problems.csp);
        if (response.status() !== 200) bad.push(`${path} ${response.status()}`);
        else if (dir !== (locale === "ar" ? "rtl" : "ltr")) bad.push(`${path} dir=${dir}`);
        else if (problems.errors.length) bad.push(`${path} ${problems.errors[0]}`);
        await context.close();
      }
      check(`admin pages render signed in (${locale}): 200, correct direction, no page errors`, bad.length === 0, bad.slice(0, 3).join(" | ") || "8 pages");
    }

    // ---- Requests list: pagination, filters, search, priority ------------------------------------------------
    {
      const { page, context } = await open(browser, "/en/admin/applications");
      const text = await bodyText(page);
      const rows = await rowCount(page);
      const tiers = await page.locator("table tbody tr td:nth-child(4) span").allInnerTexts();
      check("requests list shows page 1 of 2 with 25 rows", rows === 25 && text.includes("Page 1 of 2") && text.includes("1–25 of 30 results"), `${rows} rows`);
      check("every request row has a priority", tiers.filter((t) => ["High", "Medium", "Low", "Closed"].includes(t.trim())).length === 25, `${tiers.length} badges`);
      const floatVisible = await page.locator(".whatsapp-float").isVisible().catch(() => false);
      check("the customer WhatsApp button is hidden in the admin area", !floatVisible);
      const next = page.getByRole("link", { name: "Next", exact: true });
      await next.scrollIntoViewIfNeeded();
      await Promise.all([page.waitForURL(/page=2/, { waitUntil: "commit" }), next.click()]);
      await page.waitForLoadState("networkidle");
      check("the next page shows the remaining 5 requests", (await rowCount(page)) === 5 && (await bodyText(page)).includes("Page 2 of 2"));
      await context.close();
    }
    {
      const { page, context } = await open(browser, "/en/admin/applications?status=new");
      const text = await bodyText(page);
      check("a status filter narrows the list and the count", (await rowCount(page)) === 3 && text.includes("1–3 of 3 results"), `${await rowCount(page)} rows`);
      await context.close();
    }
    {
      const { page, context } = await open(browser, "/en/admin/applications?q=QA00000005");
      check("search by reference finds exactly one request", (await rowCount(page)) === 1 && (await bodyText(page)).includes("GTA-2611-QA00000005"));
      await context.close();
    }

    // ---- Request detail: qualification, checklist, a real write through the form ----------------------------
    {
      const { page, context } = await open(browser, `/en/admin/applications/${FIRST}`);
      const text = await bodyText(page);
      const checklist = page.locator("section", { hasText: "Document checklist" });
      const items = await checklist.locator("li").allInnerTexts();
      check("the detail page shows the lead qualification and next step", text.includes("Lead qualification") && /next step/i.test(text) && text.includes("Not contacted yet"));
      check(
        "the document checklist reflects the uploaded documents",
        items.some((t) => t.startsWith("Passport") && t.includes("Checked")) && items.some((t) => /photo/i.test(t) && t.includes("Uploaded, not checked")) && items.some((t) => t.includes("Missing")),
        items.map((t) => t.replace(/\s+/g, " ")).join(" | "),
      );
      const writesBefore = fake.state.writes.length;
      const contactForm = page.locator("form", { has: page.getByRole("button", { name: "Record the contact" }) });
      await contactForm.locator('input[name="note"]').fill("QA contact");
      await contactForm.getByRole("button", { name: "Record the contact" }).click();
      await page.getByText("Contact recorded.").waitFor({ timeout: 15_000 });
      const writes = fake.state.writes.slice(writesBefore);
      check(
        "recording a contact updates the request and appends to the activity log",
        writes.some((w) => w.table === "applications" && w.method === "PATCH" && w.count === 1 && w.patch?.last_contact_channel === "whatsapp") &&
          writes.some((w) => w.table === "crm_activity" && w.method === "POST"),
        writes.map((w) => `${w.method} ${w.table}`).join(", "),
      );
      await page.reload({ waitUntil: "networkidle" });
      check("after the contact, the qualification counts it", (await bodyText(page)).includes("Contacted by the team"));
      await page.screenshot({ path: join(SHOTS, "detail-en-light.png"), fullPage: true });
      await context.close();
    }

    // ---- Customers: pagination and search --------------------------------------------------------------------
    {
      const { page, context } = await open(browser, "/en/admin/customers");
      const text = await bodyText(page);
      check("customers list is paginated with the total count", (await rowCount(page)) === 25 && text.includes("1–25 of 32 results") && text.includes("Page 1 of 2"), `${await rowCount(page)} rows`);
      await context.close();
      const search = await open(browser, "/en/admin/customers?q=customer7-qa");
      check("customer search finds the matching customer", (await rowCount(search.page)) === 1 && (await bodyText(search.page)).includes("customer7-qa@example.test"));
      await search.context.close();
    }

    // ---- Dark and light themes ------------------------------------------------------------------------------
    {
      const light = await open(browser, "/en/admin/applications");
      const lightPanel = await light.page.evaluate(() => getComputedStyle(document.querySelector("section.rounded-3xl")).backgroundColor);
      check("the light theme is the default", (await light.page.getAttribute("[data-admin-root]", "data-theme")) === "light" && lightPanel === "rgb(255, 255, 255)", lightPanel);
      await light.page.getByRole("button", { name: "Dark" }).click();
      const switched = await light.page.getAttribute("[data-admin-root]", "data-theme");
      const saved = (await light.context.cookies()).find((c) => c.name === "gta_admin_theme")?.value;
      check("the theme switch applies at once and remembers the choice", switched === "dark" && saved === "dark", `${switched}, cookie=${saved}`);
      await light.context.close();

      for (const locale of ["en", "ar"]) {
        const dark = await open(browser, `/${locale}/admin/applications`, { theme: "dark" });
        const colors = await dark.page.evaluate(() => {
          const panel = document.querySelector("section.rounded-3xl");
          const title = panel.querySelector("h2");
          const muted = panel.querySelector(".text-navy-600, .text-navy-500");
          return {
            theme: document.querySelector("[data-admin-root]").dataset.theme,
            panel: getComputedStyle(panel).backgroundColor,
            title: getComputedStyle(title).color,
            muted: muted ? getComputedStyle(muted).color : null,
            site: getComputedStyle(document.querySelector("footer") ?? document.body).backgroundColor,
          };
        });
        const titleRatio = contrast(rgb(colors.title), rgb(colors.panel));
        const mutedRatio = colors.muted ? contrast(rgb(colors.muted), rgb(colors.panel)) : 99;
        check(
          `dark theme (${locale}): dark panels, readable text (title ${titleRatio.toFixed(1)}:1, muted ${mutedRatio.toFixed(1)}:1)`,
          colors.theme === "dark" && colors.panel === "rgb(12, 22, 40)" && titleRatio >= 7 && mutedRatio >= 4.5,
          `panel ${colors.panel}`,
        );
        await dark.page.screenshot({ path: join(SHOTS, `applications-${locale}-dark.png`), fullPage: true });
        await dark.context.close();
      }
      const detailDark = await open(browser, `/ar/admin/applications/${FIRST}`, { theme: "dark", width: 390, height: 844 });
      await detailDark.page.screenshot({ path: join(SHOTS, "detail-ar-dark-390.png"), fullPage: true });
      check("dark theme on a phone (ar): no horizontal scroll, no page errors", (await overflow(detailDark.page)) <= 1 && detailDark.problems.errors.length === 0, `overflow ${await overflow(detailDark.page)}px`);
      await detailDark.context.close();

      const publicPage = await open(browser, "/en", { as: null, theme: "dark" });
      const publicTheme = await publicPage.page.evaluate(() => ({ root: document.querySelector("[data-admin-root]") !== null, bg: getComputedStyle(document.body).backgroundColor }));
      check("the public site ignores the admin theme cookie", !publicTheme.root && publicTheme.bg === "rgb(255, 255, 255)", publicTheme.bg);
      await publicPage.context.close();
    }

    // ---- Phone width: admin pages never scroll sideways -------------------------------------------------------
    {
      const bad = [];
      for (const path of ["/en/admin", "/ar/admin/applications", `/fr/admin/applications/${FIRST}`, "/ar/admin/customers", "/en/admin/reports"]) {
        const { page, context } = await open(browser, path, { width: 390, height: 844 });
        const px = await overflow(page);
        if (px > 1) bad.push(`${path} ${px}px`);
        await context.close();
      }
      check("admin pages have no horizontal scroll at 390px", bad.length === 0, bad.join(" | ") || "5 pages");
    }

    // ---- Customer request page: document checklist ------------------------------------------------------------
    {
      const { page, context, response, problems } = await open(browser, `/fr/dashboard/requests/${FIRST}`, { as: "customer" });
      const text = await bodyText(page);
      check(
        "the customer sees the usual documents for their request (fr)",
        response.status() === 200 && text.includes("Documents habituellement nécessaires") && text.includes("Vérifié") && text.includes("Manquant") && problems.errors.length === 0,
      );
      await context.close();
    }

    check("no content-security-policy violation on the signed-in pages", allCsp.length === 0, allCsp[0] ?? `${allCsp.length} reports`);
  } catch (error) {
    check("admin browser test completed", false, error instanceof Error ? error.message.slice(0, 300) : String(error));
  } finally {
    await browser.close();
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
    await fake.stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  if (failed.length) {
    console.log(serverLog.slice(-1500));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
