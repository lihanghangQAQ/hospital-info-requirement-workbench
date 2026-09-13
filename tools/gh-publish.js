#!/usr/bin/env node
/* =====================================================================
 * GitHub 免-git 发布脚本 —— 仅访问 api.github.com
 * ---------------------------------------------------------------------
 * 适用场景：github.com 主站被网络封锁（本仓库开发环境即是），
 *           git push / 网页登录全部卡死，但 api.github.com 可达。
 *
 * 原理：用 GitHub REST API 直接建仓库、逐文件提交、开启 Pages，
 *       全程不访问 github.com，也不需要本地安装/配置 git。
 *
 * 用法：
 *   1) 在能打开 github.com 的网络（手机热点 / 家用电脑）创建 PAT：
 *      github.com → Settings → Developer settings
 *                 → Personal access tokens → Tokens (classic)
 *                 → Generate new token (classic)
 *      勾选：repo（全选）、workflow（如需 Actions）
 *      （若用 fine-grained：Contents=读写、Pages=读写、Metadata=读）
 *   2) 回到本机制造环境变量并执行：
 *        set GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
 *        node tools/gh-publish.js <仓库名>
 *      例：node tools/gh-publish.js hospital-info-requirement-workbench
 *
 * 说明：脚本幂等 —— 仓库已存在则复用，文件已存在则覆盖更新。
 * ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const REPO_NAME = process.argv[2] || "hospital-info-requirement-workbench";
const ROOT = path.resolve(__dirname, "..");
const API = "https://api.github.com";

// 不上传的目录/文件
const EXCLUDE = new Set([
  ".git", ".workbuddy", "node_modules", ".DS_Store", "Thumbs.db",
]);

const HDRS = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "gh-publish-script",
};

let okCount = 0;

function log(s) { console.log(s); }
function ok(s) { okCount++; log("  [OK] " + s); }
function warn(s) { log("  [!!] " + s); }

/** 带错误提示的 fetch，自动解析 JSON */
async function api(method, urlPath, body, expectCodes) {
  const opt = { method, headers: { ...HDRS } };
  if (body) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(API + urlPath, opt);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* 非 JSON */ }

  if (expectCodes && !expectCodes.includes(res.status)) {
    const msg = (json && json.message) ? json.message : (text || "").slice(0, 300);
    const err = new Error(`${method} ${urlPath} -> HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return { status: res.status, json, text };
}

/** 递归收集待上传文件，返回相对路径数组 */
function collect(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const abs = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) collect(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

/** 获取文件当前 sha（已存在时需带上才能覆盖） */
async function getSha(owner, repo, filePath, branch) {
  const r = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`,
    { headers: HDRS }
  );
  if (r.status === 200) {
    const j = await r.json();
    return j && j.sha ? j.sha : null;
  }
  return null; // 404 = 新文件
}

async function main() {
  if (!TOKEN) {
    console.error("\n[错误] 未检测到 GITHUB_TOKEN 环境变量。\n");
    console.error("请先创建 Personal Access Token，然后：");
    console.error("  Windows CMD : set GITHUB_TOKEN=ghp_xxxx  && node tools/gh-publish.js " + REPO_NAME);
    console.error("  PowerShell  : $env:GITHUB_TOKEN='ghp_xxxx'; node tools/gh-publish.js " + REPO_NAME);
    process.exit(1);
  }

  log("\n=== 1/4 校验 Token ===");
  let me;
  try {
    const r = await api("GET", "/user", null, [200]);
    me = r.json;
    ok(`已登录：${me.login}`);
  } catch (e) {
    console.error("[错误] Token 校验失败：" + e.message);
    console.error("       常见原因：token 过期 / 复制不全 / 缺少权限。");
    process.exit(1);
  }
  const owner = me.login;

  log(`\n=== 2/4 准备仓库 ${owner}/${REPO_NAME} ===`);
  let repo = null;
  try {
    const r = await api("GET", `/repos/${owner}/${REPO_NAME}`, null, [200]);
    repo = r.json;
    ok("仓库已存在，复用之");
  } catch (e) {
    if (e.status === 404) {
      const r = await api("POST", "/user/repos", {
        name: REPO_NAME,
        description: "医院信息需求管理工作台 · 单文件零依赖静态应用（Supabase 邮箱登录 + 多端同步）",
        private: false,
        auto_init: true, // 保证存在默认分支，便于后续提交
      }, [201]);
      repo = r.json;
      ok("仓库已创建（auto_init 已生成默认分支）");
    } else {
      throw e;
    }
  }
  const branch = repo.default_branch || "main";
  ok("默认分支：" + branch);

  log("\n=== 3/4 上传文件 ===");
  const files = collect(ROOT, "", []).sort();
  log(`  共 ${files.length} 个文件待处理`);
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const content = fs.readFileSync(abs).toString("base64");
    const sha = await getSha(owner, REPO_NAME, rel, branch);
    const body = {
      message: sha ? `update ${rel}` : `add ${rel}`,
      content,
      branch,
    };
    if (sha) body.sha = sha;
    try {
      await api("PUT", `/repos/${owner}/${REPO_NAME}/contents/${encodeURIComponent(rel)}`, body, [200, 201]);
      ok((sha ? "更新 " : "新增 ") + rel);
    } catch (e) {
      warn(`失败 ${rel} -> ${e.message}`);
    }
  }

  log("\n=== 4/4 开启 GitHub Pages ===");
  try {
    await api("POST", `/repos/${owner}/${REPO_NAME}/pages`, {
      source: { branch: branch, path: "/" },
    }, [201, 204, 409]);
    ok("Pages 已开启（分支 " + branch + " / 根目录）");
  } catch (e) {
    // 409 = 已开启，属正常
    if (e.status === 409) ok("Pages 此前已开启");
    else warn("Pages 开启失败：" + e.message + "\n       可在仓库 Settings → Pages 手动开启。");
  }

  let url = `https://${owner}.github.io/${REPO_NAME}/`;
  try {
    const r = await api("GET", `/repos/${owner}/${REPO_NAME}/pages`, null, [200]);
    if (r.json && r.json.html_url) url = r.json.html_url;
  } catch (_) { /* 读不到就用拼的地址 */ }

  log("\n" + "=".repeat(56));
  log("完成：" + okCount + " 项成功");
  log("仓库：" + `https://github.com/${owner}/${REPO_NAME}`);
  log("线上：" + url);
  log("=".repeat(56));
  log("\n提示：Pages 首次构建需 1～3 分钟；访问前记得 Ctrl+F5 强刷。\n");
}

main().catch((e) => {
  console.error("\n[致命错误] " + e.message);
  process.exit(1);
});
