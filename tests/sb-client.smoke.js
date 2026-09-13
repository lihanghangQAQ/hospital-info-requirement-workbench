/* =====================================================================
 * sb-client.js 冒烟测试（Node，无需浏览器，无第三方依赖）
 * 覆盖：请求构造 / 204 空响应 / 空数组 / 401 自动续期并重试一次 / 超时 408 / 登录登出
 * 运行：node tests/sb-client.smoke.js   → 期望输出 SB_CLIENT_SMOKE_PASS
 * ===================================================================== */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "assets", "sb-client.js"), "utf8");
const SESSION_KEY = "hirw_sb_session";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  [OK] " + name); }
  else { fail++; console.log("  [FAIL] " + name + (extra ? " -> " + extra : "")); }
}

/* ---------- 环境桩 ---------- */
function mkLocalStorage() {
  const m = Object.create(null);
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; }
  };
}

function freshSession() {
  return {
    access_token: "AT-1",
    refresh_token: "RT-1",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "u-1", email: "a@b.com" }
  };
}

/** 构造一个加载了 sb-client.js 的沙箱；seed=true 时预置有效会话 */
function makeEnv(fetchImpl, seed) {
  const win = {
    SB_CONFIG: { url: "https://demo.supabase.co", anonKey: "TEST-ANON", timeoutMs: 40 }
  };
  const store = mkLocalStorage();
  if (seed) store.setItem(SESSION_KEY, JSON.stringify(freshSession()));

  const calls = [];
  const ctx = {
    window: win,
    localStorage: store,
    console,
    setTimeout, clearTimeout,
    Promise, Date, Math, JSON, encodeURIComponent, decodeURIComponent,
    AbortController: class {
      constructor() { this.signal = { aborted: false }; }
      abort() { this.signal.aborted = true; }
    },
    fetch: function (url, init) {
      calls.push({ url, init });
      return fetchImpl(url, init, calls.length);
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { SB: win.SB, store, calls };
}

function res(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? "" : body)
  });
}

(async function run() {
  console.log("\n== 1. 请求构造（upsert 幂等写）==");
  {
    const e = makeEnv(() => res(201, ""), true);
    const r = await e.SB.from("requirements").upsert([{ id: "id-1", code: "RQ-1" }]);
    const c = e.calls[e.calls.length - 1];
    ok("URL 指向 /rest/v1/requirements", c.url.indexOf("/rest/v1/requirements") >= 0, c.url);
    ok("method = POST", c.init.method === "POST", c.init.method);
    ok("Prefer 含 resolution=merge-duplicates（幂等）",
      (c.init.headers.Prefer || "").indexOf("resolution=merge-duplicates") >= 0, c.init.headers.Prefer);
    ok("带 apikey", c.init.headers.apikey === "TEST-ANON");
    ok("带 Bearer token", c.init.headers.Authorization === "Bearer AT-1", c.init.headers.Authorization);
    ok("201 空响应体不抛错", r === null || r === undefined, String(r));
  }

  console.log("\n== 2. 204 No Content 空响应安全 ==");
  {
    const e = makeEnv(() => res(204, ""), true);
    let threw = false, val;
    try { val = await e.SB.from("logs").in("id", ["a"]).del(); } catch (err) { threw = true; }
    ok("DELETE 204 不抛错", !threw);
    ok("204 返回 null", val === null || val === undefined, String(val));
  }

  console.log("\n== 3. 空数组 / 正常查询 ==");
  {
    const e = makeEnv(() => res(200, "[]"), true);
    const rows = await e.SB.from("requirements").select("*").eq("user_id", "u-1");
    ok("空数组 -> [] 且不抛错", Array.isArray(rows) && rows.length === 0, JSON.stringify(rows));
    const c = e.calls[e.calls.length - 1];
    ok("select/eq 正确进入 querystring",
      c.url.indexOf("select=*") >= 0 && c.url.indexOf("user_id=eq.u-1") >= 0, c.url);

    const e2 = makeEnv(() => res(200, JSON.stringify([{ id: "x", code: "C1" }])), true);
    const rows2 = await e2.SB.from("requirements").select("*");
    ok("正常返回数组", Array.isArray(rows2) && rows2.length === 1 && rows2[0].code === "C1");
  }

  console.log("\n== 4. 401 自动续期并重试一次 ==");
  {
    let n = 0;
    const e = makeEnv(function (url) {
      n++;
      if (url.indexOf("grant_type=refresh_token") >= 0) {
        return res(200, JSON.stringify({
          access_token: "AT-2", refresh_token: "RT-2",
          expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u-1" }
        }));
      }
      if (n === 1) return res(401, JSON.stringify({ message: "JWT expired" }));
      return res(200, JSON.stringify([{ id: "ok" }]));
    }, true);
    const rows = await e.SB.from("requirements").select("*");
    ok("401 后重试成功并返回数据", Array.isArray(rows) && rows[0] && rows[0].id === "ok", JSON.stringify(rows));
    ok("共 3 次请求（1 失败 + 1 续期 + 1 重试）", e.calls.length === 3, "calls=" + e.calls.length);
    const retryCall = e.calls[e.calls.length - 1];
    ok("重试使用新 token AT-2", retryCall.init.headers.Authorization === "Bearer AT-2",
      retryCall.init.headers.Authorization);
    const saved = JSON.parse(e.store.getItem(SESSION_KEY));
    ok("新 token 已持久化", saved.access_token === "AT-2", saved.access_token);
  }

  console.log("\n== 5. 续期失败（refresh_token 失效）-> 清空会话 ==");
  {
    const e = makeEnv(function (url) {
      if (url.indexOf("grant_type=refresh_token") >= 0) return res(400, JSON.stringify({ message: "invalid refresh" }));
      return res(401, JSON.stringify({ message: "JWT expired" }));
    }, true);
    let err = null;
    try { await e.SB.from("requirements").select("*"); } catch (x) { err = x; }
    ok("抛出错误", !!err);
    ok("会话已清空（避免死循环）", e.store.getItem(SESSION_KEY) === null,
      String(e.store.getItem(SESSION_KEY)));
  }

  console.log("\n== 6. 超时 -> status 408 ==");
  {
    const e = makeEnv(function () {
      const err = new Error("aborted"); err.name = "AbortError";
      return Promise.reject(err);
    }, true);
    let err = null;
    try { await e.SB.from("requirements").select("*"); } catch (x) { err = x; }
    ok("AbortError 转为 408", err && err.status === 408, err && err.message);
  }

  console.log("\n== 7. 登录与登出 ==");
  {
    const e = makeEnv(function (url) {
      if (url.indexOf("grant_type=password") >= 0) {
        return res(200, JSON.stringify({
          access_token: "AT-L", refresh_token: "RT-L", expires_in: 3600,
          user: { id: "u-L", email: "x@y.com" }
        }));
      }
      if (url.indexOf("/auth/v1/logout") >= 0) return res(204, "");
      return res(200, "[]");
    }, false);
    const sess = await e.SB.auth.signIn("x@y.com", "pw");
    ok("登录拿到 access_token", sess.access_token === "AT-L");
    ok("会话已写入 localStorage", !!e.store.getItem(SESSION_KEY));
    ok("userId 正确", e.SB.userId() === "u-L", String(e.SB.userId()));
    await e.SB.auth.signOut();
    ok("登出后本地会话清除", e.store.getItem(SESSION_KEY) === null);
  }

  console.log("\n== 8. Query 的 thenable 协议补全（回归：login -> retry(fn) 里 fn() 返回 Query）==");
  {
    // 回归用例：sb-sync.js 的 retry(fn) 内部写的是 fn().catch(...)，
    // 而 fn() 返回的是 Query（thenable 而非 Promise），旧版缺 catch 会抛
    // "fn(...).catch is not a function"，表现为登录时报错、进不去。
    const e = makeEnv(() => res(200, "[]"), true);
    let threw = null, got = null;
    try { got = await e.SB.from("requirements").select("*").catch(function () { return "caught"; }); }
    catch (x) { threw = x; }
    ok("Query.catch 存在且不抛 TypeError", !threw, threw && threw.message);
    ok("成功路径下 catch 透传原值", Array.isArray(got) && got.length === 0, JSON.stringify(got));

    const errEnv = makeEnv(() => res(500, JSON.stringify({ message: "boom" })), true);
    let caught = null;
    try {
      await errEnv.SB.from("requirements").select("*").catch(function (err) { caught = err; return "handled"; });
    } catch (x) { caught = null; }
    ok("失败路径下 catch 能捕获到错误", caught && caught.status === 500, caught && caught.message);

    const finEnv = makeEnv(() => res(200, "[]"), true);
    let fin = false;
    const val = await finEnv.SB.from("requirements").select("*").finally(function () { fin = true; });
    ok("Query.finally 执行且透传原值", fin === true && Array.isArray(val), "fin=" + fin);
  }

  console.log("\n---------------------------------------");
  console.log(fail === 0
    ? "SB_CLIENT_SMOKE_PASS  (" + pass + " 项全部通过)"
    : "SB_CLIENT_SMOKE_FAIL  (" + fail + " 项失败)");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("运行异常:", e); process.exit(1); });
