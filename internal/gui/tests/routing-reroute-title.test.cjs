// Run with Node's test runner and Playwright on the module path; see README.md.
// A rerouted request's row says, in its title too, where it went (#337: 请求
// 改道后，悬停 title 仍是原来的路径): the first try failed and another took it,
// the row names the one that took it, and hovering it said the model and
// provider the request resolved to first. The title now names the one that
// took it, then where it was rerouted from, in the window's Requests list and
// the tray panel's Routing tab alike. A single try also names its actual seat
// (#6040), including one still answering; the resolved provider can differ.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");
const now = new Date();
const at = (min) => new Date(now.getTime() - min * 60e3).toISOString();
const plan = { id: "claude:a", provider: "claude", name: "Claude", kind: "account", who: "ann@example.com", model: "claude-opus-5" };
const relay = { id: "relay", provider: "relay", name: "Relay", kind: "provider", model: "gpt-6-sol" };
const routes = [
  // a group's first actual try need not be on its resolved provider
  { id: 104, seq: 104, time: at(1), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: relay.id, model: relay.model, start: at(1), done: true, status: 200, ms: 800 }],
    done: true, status: 200, ms: 800, tokens: 500 },
  { id: 103, seq: 103, time: at(1), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: relay.id, model: relay.model, start: at(1), done: false }], done: false },
  // the plan's account rate limited, the relay took it
  { id: 102, seq: 102, time: at(2), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: plan.id, model: plan.model, start: at(2), done: true, status: 429, ms: 300, fail: "rate" },
      { id: relay.id, model: relay.model, start: at(2), done: true, status: 200, ms: 1200 }],
    done: true, status: 200, ms: 1500, tokens: 900 },
  // answered on the first try
  { id: 101, seq: 101, time: at(4), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: plan.id, model: plan.model, start: at(4), done: true, status: 200, ms: 800 }],
    done: true, status: 200, ms: 800, tokens: 500 },
  // no attempt, or a seat absent from an older trace: keep the known provider
  { id: 100, seq: 100, time: at(5), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay], tries: [], done: false },
  { id: 99, seq: 99, time: at(6), agent: "codex", model: "group/best", provider: "claude", order: [],
    tries: [{ id: "missing", model: relay.model, start: at(6), done: true, status: 200, ms: 800 }],
    done: true, status: 200, ms: 800 },
  // failed and canceled requests still have no answering seat in their title
  { id: 98, seq: 98, time: at(7), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: relay.id, model: relay.model, start: at(7), done: true, status: 500, fail: "error", ms: 800 }],
    done: true, status: 500, ms: 800 },
  // retrying the same seat must not say it was rerouted from itself
  { id: 97, seq: 97, time: at(8), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: plan.id, model: plan.model, start: at(8), done: true, status: 429, fail: "rate", ms: 300 },
      { id: plan.id, model: plan.model, start: at(8), done: true, status: 200, ms: 800 }],
    done: true, status: 200, ms: 1100 },
  { id: 96, seq: 96, time: at(9), agent: "codex", model: "group/best", provider: "claude", order: [plan, relay],
    tries: [{ id: relay.id, model: relay.model, start: at(9), done: true, status: 499, gone: true, ms: 800 }],
    done: true, canceled: true, status: 499, ms: 800 },
];

function serve(lang, shown = routes) {
  const state = { agents: [{ id: "codex", name: "Codex", path: "/test/config.toml", fields: [] }], profiles: [], settings: { lang, theme: "light" } };
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:true};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json(state);
    if (url.pathname === "/api/gateway/trace") {
      if (url.searchParams.get("wait")) return; // keep the intercepted poll pending until the context closes
      return json({ mine: true, now: now.toISOString(), seq: shown[0].seq, totals: { requests: shown.length, rerouted: 1, errors: 1 }, routes: shown });
    }
    if (url.pathname === "/api/gateway/history") return json({ cut: false, days: [], routes: [] });
    if (url.pathname === "/api/usage/quotas") return json([]);
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/groups") return json({ groups: [] });
    if (url.pathname === "/api/providers") return json({ providers: [], gateway: { running: true, window: true } });
    if (url.pathname === "/api/window/main" || url.pathname === "/api/window/fit") return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await route.fulfill({ body: await fs.readFile(file), contentType });
  };
}

const relayTitle = "Codex · group/best → Relay · gpt-6-sol";
const planTitle = "Codex · group/best → Claude · ann@example.com · claude-opus-5";
const resolvedTitle = "Codex · group/best → claude";

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of ["en", "zh", "zh-TW", "ja", "de"]) {
    test(`${engine} ${lang}: a request's title names its answering seat, on one try or after rerouting`, async (t) => {
      const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
      const errors = [], pages = [];
      t.after(async () => {
        if (process.env.ARTIFACT_DIR) {
          await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
          for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(process.env.ARTIFACT_DIR, `${engine}-${lang}-reroute-title-${i}.png`) });
        }
        await browser.close();
      });
      const open = async (url, viewport, shown = routes) => {
        const page = await (await browser.newContext({ viewport, reducedMotion: "reduce" })).newPage();
        pages.push(page);
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(60000);
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", serve(lang, shown));
        await page.goto(url);
        return page;
      };

      // the window's Requests list
      const win = await open("http://magpie.test/?view=routing", { width: 1100, height: 760 });
      await win.locator(".rt-req").nth(routes.length - 1).waitFor();
      const rows = await win.locator(".rt-req").evaluateAll((rs) => rs.map((r) => ({ title: r.title, to: r.querySelector(".to").textContent })));
      const from = await win.evaluate(() => t("rerouted from {from}", { from: "Claude · ann@example.com · claude-opus-5" }));
      const want = [relayTitle, relayTitle, relayTitle + "\n" + from, planTitle, resolvedTitle, resolvedTitle, resolvedTitle, planTitle, resolvedTitle];
      assert.deepEqual(rows.map((r) => r.title), want);
      assert.match(rows[0].to, /Relay · gpt-6-sol/, "the row itself names the one that took it");
      assert.match(rows[1].to, /Relay/, "the in-flight row names its only try");

      // The tray shows at most six requests; exercise every case in two batches.
      for (let start = 0; start < routes.length; start += 6) {
        const shown = routes.slice(start, start + 6);
        const panel = await open("http://magpie.test/?mode=panel", { width: 440, height: 600 }, shown);
        await panel.locator('[data-ptab="routing"]').click();
        await panel.locator("button.pr-req").nth(shown.length - 1).waitFor();
        const prows = await panel.locator("button.pr-req").evaluateAll((rs) => rs.map((r) => ({ title: r.title, where: r.querySelector(".pr-where").textContent })));
        assert.deepEqual(prows.map((r) => r.title), want.slice(start, start + 6));
        if (!start) assert.equal(prows[0].where, "Relay");
      }
      assert.deepEqual(errors, []);
    });
  }
}
