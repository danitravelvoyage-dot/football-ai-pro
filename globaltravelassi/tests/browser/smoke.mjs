// Browser smoke test against the production build. Run after `npm run build`:
//   npm run test:browser
// It starts `next start` on a free local port, checks public pages, the sign-in redirect for private pages,
// horizontal overflow on a phone-width screen, and that the scheduler trigger refuses unauthenticated calls.
// Chromium is taken from the preinstalled browser path when present; no browser is downloaded.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app", import.meta.url));

/** Every page under the admin area, found on disk, so no page is left out of the check. */
function adminPageRoutes() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "page.tsx") {
        const rel = relative(APP, dir).split(sep).join("/");
        // Dynamic segments get a valid placeholder id: the page itself must redirect before it reads it.
        out.push("/" + rel.replace(/\[locale\]/g, "").replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000001").replace(/^\//, ""));
      }
    }
  };
  walk(join(APP, "[locale]", "admin"));
  return out.map((r) => (r === "" ? "/admin" : r.startsWith("/") ? r : "/" + r));
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const EXECUTABLE = "/opt/pw-browsers/chromium";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
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

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // Start the Next binary directly in its own process group, so the whole group can be stopped on exit.
  const nextBin = new URL("../../node_modules/next/dist/bin/next", import.meta.url).pathname;
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env }, detached: true });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  try {
    await waitFor(`${base}/en`);

    // Scheduler trigger: no bearer secret means refusal, and GET is not allowed.
    const noAuth = await fetch(`${base}/api/ai/scheduler`, { method: "POST" });
    check("scheduler trigger refuses a call without the secret", noAuth.status === 401 || noAuth.status === 503, `status ${noAuth.status}`);
    const getRes = await fetch(`${base}/api/ai/scheduler`, { method: "GET" });
    check("scheduler trigger refuses GET", getRes.status === 405, `status ${getRes.status}`);

    const launchOptions = { headless: true, args: ["--no-sandbox"] };
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(EXECUTABLE)) launchOptions.executablePath = EXECUTABLE;
    } catch {
      // use the default browser
    }
    const browser = await chromium.launch(launchOptions);
    try {
      for (const locale of ["en", "fr", "ar"]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const res = await page.goto(`${base}/${locale}`, { waitUntil: "domcontentloaded" });
        const dir = await page.getAttribute("html", "dir");
        check(`public home (${locale}) renders`, res?.status() === 200, `status ${res?.status()}`);
        check(`public home (${locale}) sets direction`, locale === "ar" ? dir === "rtl" : dir === "ltr", `dir=${dir}`);
        check(`public home (${locale}) has no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
        await page.close();
      }

      // Service pages: the nine business services, in every language, with direction, a heading and no page errors.
      const serviceSlugs = ["visa-consulting", "france-visa-appointment", "appointment-assistance", "visa-file-assistance", "e-visa", "flight-booking", "hotel-booking", "travel-itinerary", "transit-airport"];
      const serviceProblems = [];
      for (const locale of ["en", "fr", "ar"]) {
        for (const slug of serviceSlugs) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const res = await page.goto(`${base}/${locale}/services/${slug}`, { waitUntil: "domcontentloaded" });
          const dir = await page.getAttribute("html", "dir");
          const h1 = await page.locator("h1").count();
          const metaDesc = await page.getAttribute('meta[name="description"]', "content");
          const priceOk = (await page.textContent("main")) ?? "";
          const problems = [];
          if (res?.status() !== 200) problems.push(`status ${res?.status()}`);
          if ((locale === "ar") !== (dir === "rtl")) problems.push(`dir ${dir}`);
          if (h1 !== 1) problems.push(`h1 count ${h1}`);
          if (!metaDesc || metaDesc.length < 20) problems.push("no meta description");
          if (/guarantee|garantis|garantie|نضمن/i.test(priceOk) === false) problems.push("no 'not promised' wording");
          if (errors.length) problems.push(errors[0]);
          if (problems.length) serviceProblems.push(`${locale}/${slug}: ${problems.join(", ")}`);
          await page.close();
        }
      }
      check(`all ${serviceSlugs.length} service pages render in en, fr and ar (RTL, one h1, meta description, no errors)`, serviceProblems.length === 0, serviceProblems.slice(0, 3).join(" | ") || "ok");

      // An unknown slug must not show a service page. (Next streams this page after its loading boundary, so the
      // status can be 200 with the not-found content; the content is what is checked here.)
      const unknown = await fetch(`${base}/en/services/not-a-service`, { redirect: "manual" });
      const unknownBody = await unknown.text();
      check("an unknown service slug shows no service page", !unknownBody.includes("Request this service") && !unknownBody.includes("What is included"), `status ${unknown.status}`);

      // Legal and trust pages in every language.
      const legalProblems = [];
      for (const locale of ["en", "fr", "ar"]) {
        for (const path of ["privacy", "terms", "cookies"]) {
          const res = await fetch(`${base}/${locale}/${path}`, { redirect: "manual" });
          if (res.status !== 200) legalProblems.push(`${locale}/${path} ${res.status}`);
        }
      }
      check("privacy, terms and cookie pages render in en, fr and ar", legalProblems.length === 0, legalProblems.join(" | ") || "ok");

      // Phone width: a service page does not scroll sideways.
      {
        const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
        await page.goto(`${base}/fr/services/visa-consulting`, { waitUntil: "domcontentloaded" });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check("service page has no horizontal scroll at 375px", overflow <= 1, `overflow ${overflow}px`);
        await page.close();
      }

      // Every admin page, in every locale, must send a signed-out visitor to sign-in and show no admin content.
      const routes = adminPageRoutes();
      let redirected = 0;
      const leaked = [];
      for (const route of routes) {
        for (const locale of ["en", "fr", "ar"]) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await page.goto(`${base}/${locale}${route}`, { waitUntil: "domcontentloaded" });
          if (/\/auth\/login/.test(page.url())) redirected += 1;
          else leaked.push(`${locale}${route} -> ${page.url()}`);
          await page.close();
        }
      }
      check(`all ${routes.length} admin pages redirect to sign-in in en, fr and ar`, leaked.length === 0 && redirected === routes.length * 3, leaked.slice(0, 3).join(" | ") || `${redirected} redirects`);

      // The sign-in, registration and password-reset forms render for each locale, without page errors.
      for (const locale of ["en", "fr", "ar"]) {
        for (const form of ["login", "register", "forgot"]) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const res = await page.goto(`${base}/${locale}/auth/${form}`, { waitUntil: "domcontentloaded" });
          const fields = await page.locator("input[type=email], input[type=password]").count();
          check(`auth ${form} (${locale}) renders its form`, res?.status() === 200 && fields >= 1 && errors.length === 0, `status ${res?.status()}, fields ${fields}, errors ${errors.length}`);
          await page.close();
        }
      }

      // Content-Security-Policy (report-only): the header is served, and no page on the public and auth routes raises a
      // violation. Violations are collected from the browser's securitypolicyviolation event, which also fires in report-only mode.
      const cspHeaderRes = await fetch(`${base}/en`, { redirect: "manual" });
      const cspHeader = cspHeaderRes.headers.get("content-security-policy-report-only") ?? "";
      check("CSP report-only header is served", cspHeader.includes("default-src 'self'") && cspHeader.includes("frame-ancestors 'none'"), cspHeader ? "present" : "missing");
      const cspViolations = [];
      for (const locale of ["en", "fr", "ar"]) {
        for (const path of ["", "/auth/login", "/auth/register", "/auth/forgot"]) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await page.addInitScript(() => {
            window.__csp = [];
            document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || "inline"}`));
          });
          await page.goto(`${base}/${locale}${path}`, { waitUntil: "load" });
          await page.waitForTimeout(500);
          const found = await page.evaluate(() => window.__csp);
          for (const v of found) cspViolations.push(`${locale}${path || "/"}: ${v}`);
          await page.close();
        }
      }
      check("no CSP violations on public and auth pages (en, fr, ar)", cspViolations.length === 0, cspViolations.slice(0, 3).join(" | ") || "0 violations");

      // Nonce-based script policy: every inline script in the HTML carries the nonce of its own response, the policy has no
      // unsafe-inline in script-src, and a second request gets a different nonce. JSON-LD blocks are data, not scripts.
      const nonceRoutes = ["/en", "/fr", "/ar", "/en/auth/login", "/fr/auth/register", "/ar/auth/forgot", "/en/this-page-does-not-exist"];
      const nonceProblems = [];
      const nonceFor = async (path) => {
        const res = await fetch(`${base}${path}`, { redirect: "manual" });
        const html = await res.text();
        const header = res.headers.get("content-security-policy-report-only") ?? "";
        return { header, html, nonce: (header.match(/'nonce-([^']+)'/) ?? [])[1] };
      };
      for (const route of nonceRoutes) {
        const { header, html, nonce } = await nonceFor(route);
        if (!nonce) {
          nonceProblems.push(`${route}: no nonce in policy`);
          continue;
        }
        const scriptSrc = header.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
        if (scriptSrc.includes("'unsafe-inline'")) nonceProblems.push(`${route}: unsafe-inline in script-src`);
        const inline = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((attrs) => !/\bsrc=/.test(attrs) && !/application\/ld\+json/.test(attrs));
        if (inline.length === 0) nonceProblems.push(`${route}: no inline scripts found (check did not run)`);
        for (const attrs of inline) if (!attrs.includes(`nonce="${nonce}"`)) nonceProblems.push(`${route}: inline script without this response's nonce`);
      }
      const first = await nonceFor("/en");
      const second = await nonceFor("/en");
      if (first.nonce === second.nonce) nonceProblems.push("nonce is the same across two requests");
      check(`every inline script carries its response nonce; nonces differ per request (${nonceRoutes.length} routes)`, nonceProblems.length === 0, nonceProblems.slice(0, 3).join(" | ") || "ok");

      // Enforcement dry run: the same pages with the policy enforced instead of reported. Hydration is proven by the
      // Next.js payload being present, which only happens when its inline scripts run. Violations are collected as well.
      const enforceChecks = [];
      for (const locale of ["en", "fr", "ar"]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await page.addInitScript(() => {
          window.__csp = [];
          document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || "inline"}`));
        });
        await page.route("**/*", async (route) => {
          if (route.request().resourceType() !== "document") return route.continue();
          const response = await route.fetch();
          const headers = { ...response.headers() };
          const reportOnly = headers["content-security-policy-report-only"];
          delete headers["content-security-policy-report-only"];
          if (reportOnly) headers["content-security-policy"] = reportOnly;
          await route.fulfill({ response, headers });
        });
        await page.goto(`${base}/${locale}/auth/login`, { waitUntil: "load" });
        const hydrated = await page
          .waitForFunction(() => Array.isArray(window.__next_f) && window.__next_f.length > 0, null, { timeout: 15_000 })
          .then(() => true, () => false);
        const violations = await page.evaluate(() => window.__csp);
        enforceChecks.push({ locale, hydrated, violations, pageErrors });
        await page.close();
      }
      const enforceFailures = enforceChecks.filter((c) => !c.hydrated || c.violations.length > 0 || c.pageErrors.length > 0);
      check("policy enforced (dry run): pages hydrate with no violations or page errors (en, fr, ar)", enforceFailures.length === 0, enforceFailures.map((c) => `${c.locale}: hydrated=${c.hydrated} violations=${c.violations.join(",") || "none"} errors=${c.pageErrors.length}`).join(" | ") || "ok");

      // Phone width: no horizontal page scroll on the home page.
      const phone = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true });
      await phone.goto(`${base}/en`, { waitUntil: "domcontentloaded" });
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check("home page has no horizontal scroll at 375px", overflow <= 1, `overflow ${overflow}px`);
      await phone.close();
    } finally {
      await browser.close();
    }
  } finally {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(serverLog.slice(-1500));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
