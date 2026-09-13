/* =====================================================================
 * 自写最小 Supabase 客户端（原生 fetch，零 SDK、零 CDN、零构建）
 * ---------------------------------------------------------------------
 * 能力清单：
 *   1. 链式调用：SB.from(t).select("*").eq("user_id",uid).in("id",[...])
 *                .insert(rows) / .upsert(rows) / .update(patch) / .del()
 *   2. 空响应体安全：204 No Content / 空 body → null；空数组 → []，不抛错
 *   3. 超时控制：AbortController，默认 15s，抛 status=408
 *   4. 401 自动续期：用 refresh_token 换新 access_token，并只重试一次
 *   5. 续期单飞（single-flight）：并发 401 只触发一次刷新请求
 *   6. refresh_token 失效（400/401）才清空会话，网络抖动不清空
 * ===================================================================== */
(function (global) {
  "use strict";

  var CFG = global.SB_CONFIG || {};
  var DEFAULT_TIMEOUT = CFG.timeoutMs || 15000;
  var SESSION_KEY = "hirw_sb_session";

  function nowSec() { return Math.floor(Date.now() / 1000); }

  /* ---------------- 会话存取 ---------------- */
  function readStoredSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.access_token) return null;
      return s;
    } catch (e) { return null; }
  }

  var _session = readStoredSession();

  function setSession(s) {
    try {
      if (!s) localStorage.removeItem(SESSION_KEY);
      else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) {}
    _session = s || null;
  }

  function getSession() { return _session; }
  function accessToken() { return _session ? _session.access_token : null; }
  function userId() {
    if (_session && _session.user && _session.user.id) return _session.user.id;
    return null;
  }
  /** 提前 60 秒判定过期，避免请求打到边界上 */
  function isExpired() {
    if (!_session || !_session.expires_at) return false;
    return nowSec() >= (_session.expires_at - 60);
  }

  /* ---------------- 响应体解析（空响应安全） ---------------- */
  function parseBody(res) {
    if (res.status === 204) return Promise.resolve(null);
    return res.text().then(function (t) {
      if (t === null || t === undefined || t === "") return null;   // 空 body
      try { return JSON.parse(t); } catch (e) { return t; }          // 非 JSON（如错误页 HTML）
    });
  }

  /* ---------------- 底层 fetch ---------------- */
  function request(path, opts) {
    opts = opts || {};
    var base = (CFG.url || "").replace(/\/+$/, "");
    var url = base + path;

    var headers = {
      "apikey": CFG.anonKey || "",
      "Content-Type": "application/json"
    };
    if (!opts.noAuth && accessToken()) headers["Authorization"] = "Bearer " + accessToken();
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    if (opts.headers) { for (var h in opts.headers) headers[h] = opts.headers[h]; }

    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = null;
    if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || DEFAULT_TIMEOUT);

    var init = {
      method: opts.method || "GET",
      headers: headers
    };
    if (opts.body !== undefined && opts.body !== null) init.body = JSON.stringify(opts.body);
    if (ctrl) init.signal = ctrl.signal;

    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return parseBody(res).then(function (data) {
        if (res.ok) return { status: res.status, data: data };
        var d = (data && typeof data === "object") ? data : {};
        var msg = d.msg || d.message || d.error_description || d.error || ("HTTP " + res.status);
        var err = new Error(msg);
        err.status = res.status;
        err.body = data;
        throw err;
      });
    }, function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === "AbortError") { var t = new Error("请求超时"); t.status = 408; throw t; }
      if (!e) { var u = new Error("网络错误"); u.status = 0; throw u; }
      throw e;
    });
  }

  /* ---------------- 续期（单飞） ---------------- */
  var _refreshing = null;
  function refreshToken() {
    if (_refreshing) return _refreshing;
    var s = _session;
    if (!s || !s.refresh_token) {
      return Promise.reject(new Error("无 refresh_token，无法续期"));
    }
    _refreshing = request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      noAuth: true,
      body: { refresh_token: s.refresh_token }
    }).then(function (r) {
      var d = r.data || {};
      if (!d.access_token) { var e = new Error("续期失败：未返回 access_token"); e.status = 401; throw e; }
      var merged = {
        access_token: d.access_token,
        refresh_token: d.refresh_token || s.refresh_token,
        expires_at: d.expires_at || (nowSec() + (d.expires_in || 3600)),
        user: d.user || s.user || null
      };
      setSession(merged);
      return merged;
    }).then(function (m) { _refreshing = null; return m; }, function (e) {
      _refreshing = null;
      // 只有 refresh_token 本身被判失效时才清空会话；网络抖动保留会话
      if (e && (e.status === 400 || e.status === 401)) setSession(null);
      throw e;
    });
    return _refreshing;
  }

  /** 请求前：若 token 临近过期则先续期 */
  function ensureFreshToken() {
    if (_session && isExpired()) {
      return refreshToken().then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(true);
  }

  /** 带 401 自动续期 + 重试一次的请求 */
  function authRequest(path, opts) {
    opts = opts || {};
    return ensureFreshToken().then(function () {
      return request(path, opts);
    }).catch(function (err) {
      if (err && err.status === 401 && !opts._retried) {
        return refreshToken().then(function () {
          opts._retried = true;
          return request(path, opts);
        });
      }
      throw err;
    });
  }

  /* ---------------- PostgREST 查询构造器 ---------------- */
  function encVal(v) {
    if (v === null || v === undefined) return "null";
    return encodeURIComponent(String(v));
  }

  function Query(table) {
    this.t = table;
    this._method = "GET";
    this._qs = [];
    this._body = null;
    this._prefer = null;
    this._timeout = null;
  }
  Query.prototype.select = function (cols) {
    this._qs.push("select=" + encodeURIComponent(cols || "*")); return this;
  };
  Query.prototype.eq = function (col, val) {
    this._qs.push(col + "=eq." + encVal(val)); return this;
  };
  Query.prototype.neq = function (col, val) {
    this._qs.push(col + "=neq." + encVal(val)); return this;
  };
  Query.prototype.in = function (col, arr) {
    var list = (arr || []).map(encVal).join(",");
    this._qs.push(col + "=in.(" + list + ")"); return this;
  };
  Query.prototype.order = function (col, opt) {
    var desc = opt && opt.ascending === false;
    this._qs.push("order=" + col + (desc ? ".desc" : ".asc")); return this;
  };
  Query.prototype.limit = function (n) { this._qs.push("limit=" + n); return this; };
  Query.prototype.insert = function (rows) {
    this._method = "POST"; this._body = rows; this._prefer = "return=minimal"; return this;
  };
  Query.prototype.upsert = function (rows) {
    this._method = "POST"; this._body = rows;
    this._prefer = "resolution=merge-duplicates,return=minimal"; return this;
  };
  Query.prototype.update = function (patch) {
    this._method = "PATCH"; this._body = patch; this._prefer = "return=minimal"; return this;
  };
  Query.prototype.del = function () {
    this._method = "DELETE"; this._prefer = "return=minimal"; return this;
  };
  Query.prototype.timeout = function (ms) { this._timeout = ms; return this; };

  Query.prototype.exec = function () {
    var qs = this._qs.slice();
    if (this._method === "GET") {
      var hasSelect = false;
      for (var i = 0; i < qs.length; i++) { if (qs[i].indexOf("select=") === 0) { hasSelect = true; break; } }
      if (!hasSelect) qs.unshift("select=*");
    }
    var path = "/rest/v1/" + this.t + (qs.length ? ("?" + qs.join("&")) : "");
    return authRequest(path, {
      method: this._method,
      body: this._body,
      prefer: this._prefer,
      timeout: this._timeout || undefined
    }).then(function (r) {
      // 统一返回 data：空 → null；查询无行 → []
      return r.data === null || r.data === undefined ? (this._method === "GET" ? [] : null) : r.data;
    }.bind(this));
  };
  /** 让 Query 成为 thenable，可直接 await / .then */
  Query.prototype.then = function (onOk, onErr) { return this.exec().then(onOk, onErr); };

  /* ---------------- 认证 ---------------- */
  var auth = {
    /** 邮箱 + 密码登录 */
    signIn: function (email, password) {
      return request("/auth/v1/token?grant_type=password", {
        method: "POST", noAuth: true, body: { email: email, password: password }
      }).then(function (r) {
        var d = r.data || {};
        if (!d.access_token) {
          var msg = d.msg || d.message || d.error_description || d.error || "登录失败";
          var e = new Error(msg); e.status = r.status; throw e;
        }
        var s = {
          access_token: d.access_token,
          refresh_token: d.refresh_token || "",
          expires_at: d.expires_at || (nowSec() + (d.expires_in || 3600)),
          user: d.user || null
        };
        setSession(s);
        return s;
      });
    },
    /** 登出：无论远端是否成功，本地会话一律清除 */
    signOut: function () {
      return request("/auth/v1/logout", { method: "POST" }).then(function () {
        setSession(null); return true;
      }, function () {
        setSession(null); return false;
      });
    },
    refresh: refreshToken,
    isExpired: isExpired
  };

  /* ---------------- 导出 ---------------- */
  global.SB = {
    from: function (table) { return new Query(table); },
    auth: auth,
    getSession: getSession,
    setSession: setSession,
    userId: userId,
    isExpired: isExpired,
    refreshToken: refreshToken,
    request: request,
    SESSION_KEY: SESSION_KEY
  };

})(window);
