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
