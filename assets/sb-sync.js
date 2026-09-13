/* =====================================================================
 * 云端同步层：邮箱登录 / 会话恢复 / 多端同步 / 彻底登出
 * ---------------------------------------------------------------------
 * 设计要点
 *   1. 无侵入接入：本文件在 index.html 主脚本之后加载，只覆盖
 *      doLogin / logoutApp / enterApp 三个入口并包装 saveArr，
 *      不改动主脚本内部任何业务逻辑。
 *   2. 本地优先：所有修改先落 localStorage（原 saveArr），再异步推云端，
 *      离线可用，网络失败仅提示不丢数据。
 *   3. 幂等写：push 一律用 upsert（按 id 合并），重复执行不产生重复行。
 *   4. 差集删除：以「上次已知的云端 ID 集合」与「本地 ID 集合」做差集删除。
 *   5. 并发控制：debounce 800ms 合并 + Promise 串行队列，杜绝重复并发写。
 *   6. 冲突判定：以 modified_at（客户端写入时生成）做最后写入胜出。
 *   7. 账号隔离：登出时清除 token、全部业务数据与全局状态并重绘空态。
 * ===================================================================== */
(function (global) {
  "use strict";

  var K = global.K, G = global.G;
  var SB = global.SB;

  var DEBOUNCE_MS = 800;
  var CHUNK = 200;          // 单次 upsert 行数
  var MAX_RETRY = 3;
  var LOG_PULL_LIMIT = 1000;
  var LOG_PUSH_LIMIT = 500;

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /* ---------------- 工具 ---------------- */
  function nowISO() { return new Date().toISOString(); }
  function s(v) { return (v === undefined || v === null) ? "" : String(v); }
  function b(v) { return !!v; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return (v && typeof v === "object") ? v : {}; }
  function dOrNull(v) { return (v === undefined || v === null || v === "") ? null : v; }
  function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }
  function $(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }

  function configured() {
    var c = global.SB_CONFIG || {};
    return !!(c.url && c.anonKey &&
      c.url.indexOf("REPLACE") < 0 && c.anonKey.indexOf("REPLACE") < 0);
  }

  function friendlyError(e) {
    var m = (e && e.message) ? String(e.message) : String(e || "未知错误");
    if (e && e.status === 408) return "网络超时，请重试";
    if (e && e.status === 0) return "网络错误，请检查网络或 Supabase 地址配置";
    if (/invalid login/i.test(m)) return "邮箱或密码错误";
    if (/email not confirmed/i.test(m)) return "邮箱尚未验证，请先到邮箱点击确认链接";
    if (/user not found/i.test(m)) return "该邮箱尚未注册";
    return m;
  }

  /* ---------------- 表映射（本地 key ↔ 云端表 ↔ 字段转换） ---------------- */
  var TABLES = [
    {
      name: "requirements", key: K.req,
      toRow: function (r) {
        return {
          id: r.id, code: s(r.code), type: s(r.type) || "RQ", year: s(r.year),
          priority: s(r.priority) || "中", category: s(r.category), dept: s(r.dept),
          submitter: s(r.submitter), systems: arr(r.systems), risk: s(r.risk) || "低",
          sensitive: b(r.sensitive), desc_text: s(r.desc), plan_text: s(r.plan),
          status: s(r.status) || "待办", phase: s(r.phase) || "需求受理",
          submit_date: dOrNull(r.submitDate), plan_date: dOrNull(r.planDate),
          done_date: dOrNull(r.doneDate), cross_year: b(r.crossYear),
          remark: s(r.remark), created_at: s(r.createdAt), updated_at: s(r.updatedAt),
          modified_at: r._m || nowISO()
        };
      },
      fromRow: function (d) {
        return {
          id: d.id, code: s(d.code), type: s(d.type) || "RQ", year: s(d.year),
          priority: s(d.priority) || "中", category: s(d.category), dept: s(d.dept),
          submitter: s(d.submitter), systems: arr(d.systems), risk: s(d.risk) || "低",
          sensitive: b(d.sensitive), desc: s(d.desc_text), plan: s(d.plan_text),
          status: s(d.status) || "待办", phase: s(d.phase) || "需求受理",
          submitDate: s(d.submit_date), planDate: s(d.plan_date), doneDate: s(d.done_date),
          crossYear: b(d.cross_year), remark: s(d.remark),
          createdAt: s(d.created_at), updatedAt: s(d.updated_at),
          _m: d.modified_at || nowISO()
        };
      }
    },
    {
      name: "app_users", key: K.users,
      toRow: function (r) {
        return {
          id: r.id, account: s(r.account), name: s(r.name),
          urole: s(r.role) || "viewer", enabled: b(r.enabled), pass: s(r.pass),
          modified_at: r._m || nowISO()
        };
      },
      fromRow: function (d) {
        return {
          id: d.id, account: s(d.account), name: s(d.name),
          role: s(d.urole) || "viewer", enabled: b(d.enabled), pass: s(d.pass),
          _m: d.modified_at || nowISO()
        };
      }
    },
    {
      name: "logs", key: K.logs, cap: LOG_PUSH_LIMIT, pullLimit: LOG_PULL_LIMIT,
      toRow: function (r) {
        return {
          id: r.id, op_time: s(r.time), who: s(r.user), action: s(r.action),
          object_type: s(r.objectType), object_id: s(r.objectId),
          diff: (r.diff === undefined ? null : r.diff), result: s(r.result) || "成功",
          modified_at: r._m || nowISO()
        };
      },
      fromRow: function (d) {
        return {
          id: d.id, time: s(d.op_time), user: s(d.who), action: s(d.action),
          objectType: s(d.object_type), objectId: s(d.object_id),
          diff: d.diff === undefined ? null : d.diff,
          result: s(d.result) || "成功", _m: d.modified_at || nowISO()
        };
      }
    },
    {
      name: "weekly_archives", key: K.weekly,
      toRow: function (r) {
        return {
          id: r.id, week_key: s(r.key), label: s(r.label),
          start_date: dOrNull(r.start), end_date: dOrNull(r.end),
          year: s(r.year), week_no: s(r.week), author: s(r.by),
          stats: obj(r.stats), narrative: s(r.narrative), created_at: s(r.createdAt),
          modified_at: r._m || nowISO()
        };
      },
      fromRow: function (d) {
        return {
          id: d.id, key: s(d.week_key), label: s(d.label),
          start: s(d.start_date), end: s(d.end_date),
          year: s(d.year), week: s(d.week_no), by: s(d.author),
          stats: obj(d.stats), narrative: s(d.narrative), createdAt: s(d.created_at),
          _m: d.modified_at || nowISO()
        };
      }
    },
    {
      name: "annual_archives", key: K.annual,
      toRow: function (r) {
        return {
          id: r.id, year: s(r.year), author: s(r.by),
          stats: obj(r.stats), narrative: s(r.narrative), created_at: s(r.createdAt),
          modified_at: r._m || nowISO()
        };
      },
      fromRow: function (d) {
        return {
          id: d.id, year: s(d.year), by: s(d.author),
          stats: obj(d.stats), narrative: s(d.narrative), createdAt: s(d.created_at),
          _m: d.modified_at || nowISO()
        };
      }
    },
    {
      name: "vocabularies", key: K.vocab,
      toRow: function (r) {
        return {
          id: r.id, cat: s(r.cat), term: s(r.term), descr: s(r.desc),
          created_at: s(r.createdAt), modified_at: r._m || nowISO()
        };
      },
      fromRow: function (d) {
        return {
          id: d.id, cat: s(d.cat), term: s(d.term), desc: s(d.descr),
          createdAt: s(d.created_at), _m: d.modified_at || nowISO()
        };
      }
    }
  ];

  function tableByKey(key) {
    for (var i = 0; i < TABLES.length; i++) if (TABLES[i].key === key) return TABLES[i];
    return null;
  }

  /* ---------------- 同步状态 ---------------- */
  var Cloud = {
    session: null,
    dirty: {},
    cloudIds: {},
    syncing: false,
    lastError: null,
    _timer: null,
    _queue: Promise.resolve()
  };
  global.Cloud = Cloud;

  var _origSaveArr = global.saveArr;
  var _origDoLogin = global.doLogin;

  function saveRaw(key, data) { _origSaveArr(key, data); }

  /* ---------------- 同步状态角标 ---------------- */
  function updateSyncBadge() {
    var el = document.getElementById("__sbBadge");
    if (!el) {
      el = document.createElement("div");
      el.id = "__sbBadge";
      el.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:9999;font-size:12px;" +
        "line-height:1;padding:7px 12px;border-radius:999px;background:rgba(62,110,154,.94);" +
        "color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.2);pointer-events:none;opacity:0;" +
        "transition:opacity .25s;font-family:-apple-system,'Segoe UI',Roboto,sans-serif";
      document.body.appendChild(el);
    }
    var txt = "", show = true;
    if (!configured()) { txt = "未配置 Supabase · 本地模式"; }
    else if (!Cloud.session) { txt = ""; show = false; }
    else if (Cloud.syncing) { txt = "同步中…"; }
    else if (Cloud.lastError) { txt = "同步失败，将自动重试"; }
    else { txt = "已同步 " + new Date().toLocaleTimeString(); }
    el.textContent = txt;
    el.style.opacity = show ? "1" : "0";
  }

  /* ---------------- 失败重试 ---------------- */
  function retry(fn, times) {
    times = times || 0;
    return fn().catch(function (e) {
      if (times >= MAX_RETRY - 1) throw e;
      var delay = 400 * Math.pow(2, times);
      return new Promise(function (r) { setTimeout(r, delay); })
        .then(function () { return retry(fn, times + 1); });
    });
  }

  /* ---------------- 脏标记与调度 ---------------- */
  function markDirty(key) {
    if (!tableByKey(key)) return;
    Cloud.dirty[key] = true;
    if (Cloud._timer) clearTimeout(Cloud._timer);
    Cloud._timer = setTimeout(function () { Cloud._timer = null; pushAll(); }, DEBOUNCE_MS);
  }

  function pushAll() {
    Cloud._queue = Cloud._queue.then(function () { return doPushAll(); })
      .catch(function (e) { Cloud.lastError = e; console.warn("[sync] push failed:", e); updateSyncBadge(); });
    return Cloud._queue;
  }

  function doPushAll() {
    if (!Cloud.session) return Promise.resolve();
    var keys = Object.keys(Cloud.dirty).filter(function (k) { return Cloud.dirty[k]; });
    if (!keys.length) return Promise.resolve();

    Cloud.syncing = true; Cloud.lastError = null; updateSyncBadge();
    var chain = Promise.resolve();
    keys.forEach(function (k) { chain = chain.then(function () { return pushTable(k); }); });
    return chain.then(function () {
      Cloud.syncing = false; updateSyncBadge();
    }, function (e) {
      Cloud.syncing = false; Cloud.lastError = e; updateSyncBadge(); throw e;
    });
  }

  function pushTable(key) {
    var t = tableByKey(key);
    if (!t) return Promise.resolve();

    var local = (global.loadArr(key, []) || []).filter(function (r) { return r && isUuid(r.id); });
    var rows = local.map(t.toRow);
    if (t.cap && rows.length > t.cap) rows = rows.slice(0, t.cap);

    var p = Promise.resolve();

    // 1) 幂等写：按 id 合并的 upsert，分块提交
    for (var i = 0; i < rows.length; i += CHUNK) {
      (function (chunk) {
        p = p.then(function () {
          return retry(function () { return SB.from(t.name).upsert(chunk); });
        });
      })(rows.slice(i, i + CHUNK));
    }

    // 2) 差集删除：已知云端 ID 中，本地已不存在的
    var known = Cloud.cloudIds[t.name] || [];
    var del = [];
    if (known.length) {
      var localIds = {};
      local.forEach(function (r) { localIds[r.id] = 1; });
      del = known.filter(function (id) { return !localIds[id]; });
    }
    for (var j = 0; j < del.length; j += 100) {
      (function (ids) {
        p = p.then(function () {
          return retry(function () { return SB.from(t.name).in("id", ids).del(); });
        });
      })(del.slice(j, j + 100));
    }

    return p.then(function () {
      Cloud.dirty[key] = false;
      var set = {};
      known.forEach(function (id) { set[id] = 1; });
      rows.forEach(function (r) { set[r.id] = 1; });
      del.forEach(function (id) { delete set[id]; });
      Cloud.cloudIds[t.name] = Object.keys(set);
    });
  }

  /* ---------------- 拉取与合并 ---------------- */
  function pullAll() {
    var totals = {};
    var chain = Promise.resolve();

    TABLES.forEach(function (t) {
      chain = chain.then(function () {
        return retry(function () {
          var q = SB.from(t.name).select("*").order("modified_at", { ascending: false });
          if (t.pullLimit) q = q.limit(t.pullLimit);
          return q;
        }).then(function (rows) { totals[t.name] = rows || []; });
      });
    });

    return chain.then(function () {
      var total = 0, n;
      for (n in totals) total += (totals[n] || []).length;

      TABLES.forEach(function (t) {
        var cloud = totals[t.name] || [];
        var local = global.loadArr(t.key, []) || [];
        var merged;

        if (total === 0) {
          // 全新账号：保留本地（含首次示例数据），随后推上云
          merged = local;
          Cloud.dirty[t.key] = true;
        } else {
          merged = mergeRows(local, cloud, t);
        }

        Cloud.cloudIds[t.name] = cloud.map(function (r) { return r.id; });
        saveRaw(t.key, merged);
      });

      if (total === 0) { pushAll(); }

      if (typeof global.refreshAll === "function") global.refreshAll();
      updateSyncBadge();
    });
  }

  /** 以 modified_at 做最后写入胜出；云端不存在的本地孤立行仅在「有未推送改动」时保留 */
  function mergeRows(local, cloud, t) {
    var localById = {};
    local.forEach(function (r) { if (r && r.id) localById[r.id] = r; });

    var out = [];
    cloud.forEach(function (d) {
      var l = localById[d.id];
      if (l && l._m && d.modified_at && String(l._m) > String(d.modified_at)) {
        out.push(l);                 // 本地更新 → 保留并随后推送
        Cloud.dirty[t.key] = true;
      } else {
        out.push(t.fromRow(d));
      }
    });

    // 本地有、云端没有的行：若该表有未推送改动则保留（防误删），否则丢弃（防多设备重复示例数据）
    if (Cloud.dirty[t.key]) {
      var cloudIds = {};
      cloud.forEach(function (d) { cloudIds[d.id] = 1; });
      local.forEach(function (r) {
        if (r && r.id && !cloudIds[r.id]) out.push(r);
      });
    }
    return out;
  }

  /* ---------------- 旧 ID 迁移（"r"+base36 → UUID） ---------------- */
  function migrateLocalIds() {
    TABLES.forEach(function (t) {
      var local = global.loadArr(t.key, []) || [];
      var changed = false;
      local.forEach(function (r) {
        if (r && !isUuid(r.id)) { r.id = uuidV4(); changed = true; }
      });
      if (changed) saveRaw(t.key, local);
    });
  }

  function uuidV4() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    // 非安全上下文（如 file://）回退
    var d = new Date().getTime();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /* ---------------- 会话 / 用户信息 ---------------- */
  function applyUser(sess) {
    var u = (sess && sess.user) || {};
    var email = u.email || "";
    var disp = (u.user_metadata && u.user_metadata.name) ? u.user_metadata.name : email;
    G.user = {
      id: u.id || "",
      account: email,
      name: disp || email,
      email: email,
      role: "admin",
      enabled: true
    };
  }

  function showAppShell() {
    var lg = $("#loginGate"), app = $("#app");
    if (lg) lg.style.display = "none";
    if (app) app.style.display = "flex";
    var nm = G.user ? (G.user.name || G.user.account) : "";
    var un = $("#userName"); if (un) un.textContent = nm;
    var av = $("#userAv"); if (av) av.textContent = (nm || "?").charAt(0).toUpperCase();
    if (typeof global.setView === "function") global.setView(G.view || "dashboard");
  }

  /* ---------------- 彻底登出 ---------------- */
  function hardLogout() {
    // 1) 远端撤销 refresh_token
    try { SB.auth.signOut(); } catch (e) {}

    // 2) 清除 token / 会话
    try { localStorage.removeItem(SB.SESSION_KEY); } catch (e) {}
    try { SB.setSession(null); } catch (e) {}

    // 3) 清除全部本地业务数据（账号隔离的关键）
    var keys = [K.req, K.users, K.logs, K.weekly, K.annual, K.vocab, K.settings, K.seeded, "v2_session"];
    keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });

    // 4) 重置全局状态
    Cloud.session = null; Cloud.dirty = {}; Cloud.cloudIds = {};
    Cloud.lastError = null; Cloud.syncing = false;
    if (Cloud._timer) { clearTimeout(Cloud._timer); Cloud._timer = null; }
    try { global.logs = []; } catch (e) {}
    G.user = null;
    G.view = "dashboard"; G.dragged = null; G.wkSel = null; G.anaYear = null;
    G.dashSort = null; G.dashOrder = null; G.dashTab = null; G.ovSec = null;
    G.anNarrHtml = null;

    // 5) 重绘为未登录空数据态
    var main = $("#main"); if (main) main.innerHTML = "";
    try { if (typeof global.renderSidebar === "function") { /* G.user 为空时内部自行短路 */ } } catch (e) {}
    if (typeof global.showLogin === "function") global.showLogin();
    updateSyncBadge();
  }

  /* ---------------- 覆盖主脚本入口 ---------------- */

  // 登录：邮箱 + 密码（未配置 Supabase 时回退原本地登录，保证纯静态可用）
  global.doLogin = function () {
    if (!configured()) { return _origDoLogin(); }

    var email = (($("#lgUser") || {}).value || "").trim();
    var pass = ($("#lgPass") || {}).value || "";
    var errEl = $("#lgErr");

    if (!email || !pass) { if (errEl) errEl.textContent = "请输入邮箱和密码"; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (errEl) errEl.textContent = "请输入有效的邮箱地址"; return; }
    if (errEl) errEl.textContent = "登录中…";

    SB.auth.signIn(email, pass).then(function (sess) {
      Cloud.session = sess;
      applyUser(sess);
      migrateLocalIds();
      return pullAll();
    }).then(function () {
      if (errEl) errEl.textContent = "";
      showAppShell();
      updateSyncBadge();
    }).catch(function (e) {
      if (errEl) errEl.textContent = friendlyError(e);
      console.warn("[auth] signIn failed:", e);
    });
  };

  // 登出：彻底清理
  global.logoutApp = function () { hardLogout(); };

  // 进入应用：带会话恢复（刷新不掉登录态）
  var _origEnterApp = global.enterApp;
  global.enterApp = function () {
    var sess = SB.getSession();
    if (!configured()) { return _origEnterApp(); }
    if (!sess || !sess.access_token) {
      if (typeof global.showLogin === "function") global.showLogin();
      updateSyncBadge();
      return;
    }

    Cloud.session = sess;
    applyUser(sess);
    showAppShell();          // 先用本地数据出画面
    updateSyncBadge();

    // 异步：必要时续期 → 迁移旧 ID → 拉云端 → 重绘
    var prep = SB.isExpired()
      ? SB.refreshToken().catch(function () { return null; })
      : Promise.resolve(sess);

    prep.then(function (s2) {
      if (!s2) {                       // 续期失败 → 视为未登录
        Cloud.session = null;
        if (typeof global.showLogin === "function") global.showLogin();
        updateSyncBadge();
        return null;
      }
      Cloud.session = s2;
      applyUser(s2);
      migrateLocalIds();
      return pullAll();
    }).then(function () {
      if (Cloud.session && typeof global.refreshAll === "function") global.refreshAll();
      updateSyncBadge();
    }).catch(function (e) {
      console.warn("[sync] init failed:", e);
      Cloud.lastError = e;
      updateSyncBadge();
    });
  };

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 包装 saveArr：先落本地，再标记待推送
    global.saveArr = function (key, data) {
      try {
        if (data && data.length && typeof data[0] === "object") {
          var ts = nowISO();
          for (var i = 0; i < data.length; i++) {
            if (data[i] && typeof data[i] === "object") data[i]._m = ts;
          }
        }
      } catch (e) {}
      _origSaveArr(key, data);
      if (Cloud.session && configured()) markDirty(key);
    };

    var sess = SB.getSession();
    if (sess && sess.access_token) Cloud.session = sess;
    updateSyncBadge();
  }

  boot();

})(window);
