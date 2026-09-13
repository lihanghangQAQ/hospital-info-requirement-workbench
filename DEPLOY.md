# 部署步骤 —— 需要你手工完成的部分

我无法替你注册 Supabase 或创建 GitHub 仓库（需要你的账号与授权），因此以下三步请你执行。
代码、SQL、配置模板我都已准备好，你只需填空 + 点几下控制台。

预计耗时：**15～20 分钟**。

---

## A. 创建 Supabase 项目并建表

### A1. 新建项目
1. 打开 https://supabase.com 注册/登录。
2. **New project**
   - Name：随意，例如 `hospital-req-workbench`
   - Database Password：**自己记牢**（后面不看也能用，但重置很麻烦）
   - Region：建议 **Southeast Asia (Singapore)** —— 国内访问相对最快
3. 等待 1～2 分钟项目初始化完成。

### A2. 建表 + 开启 RLS
1. 左侧菜单 **SQL Editor** → **New query**。
2. 打开本仓库的 `supabase/schema.sql`，**全选复制粘贴**进去 → 点 **Run**。
3. 期望看到 `Success. No rows returned`。
4. 可选自检：在同一窗口执行下面的 SQL，6 张表的 `rowsecurity` 应全部为 `t`：
   ```sql
   select tablename, rowsecurity from pg_tables
    where schemaname='public'
      and tablename in ('requirements','app_users','logs',
                        'weekly_archives','annual_archives','vocabularies');
   ```
   再确认策略：
   ```sql
   select tablename, policyname, cmd from pg_policies where schemaname='public';
   ```
   期望 6 条 `own_rows_*`，`cmd` 全为 `ALL`。

### A3. 邮件登录设置
1. 左侧 **Authentication** → **Sign In / Providers** → **Email**。
2. 确认 **Enable Email provider** 为开启。
3. **Confirm email**：建议**先关闭**（开发/自用阶段），否则新用户必须点邮件链接才能登录。
   - 若保持开启，注册后要去邮箱点确认链接，否则登录会报「邮箱尚未验证」。

### A4. 创建登录账号
1. 左侧 **Authentication** → **Users** → 右上角 **Add user**。
2. 填写邮箱 + 密码 → **勾选 `Auto Confirm User`** → **Create user**。
3. 这个邮箱/密码就是你登录工作台用的账号。

> ⚠️ 安全提醒：只使用 **anon / public key**。**绝不要**把 `service_role` key 填进前端。

---

## B. 填入连接配置

编辑仓库根目录下的 **`assets/config.js`**，把两个占位符替换掉：

```js
window.SB_CONFIG = {
  url: "https://xxxxxxxxxxxx.supabase.co",   // ← A1 的 Project URL
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",  // ← anon public key
  timeoutMs: 15000
};
```

取值位置：**Project Settings（齿轮）→ API**
- **Project URL** → 填到 `url`
- **Project API keys → `anon` `public`** → 填到 `anonKey`

> anon key 的设计就是「可公开」，它本身没有任何权限，真正的边界由 RLS 策略
> `auth.uid() = user_id` 保证，所以提交到公开仓库是安全的。

**未填配置时应用不会坏**：会自动回退到原来的本地登录（`admin / admin123`，纯 localStorage），
方便你先把页面跑起来再接云。填好配置并刷新后即切换为邮箱登录。

---

## C. 推送到 GitHub 并开启 Pages

### C1. 在 GitHub 建空仓库
1. https://github.com/new
2. Repository name：例如 `hospital-info-requirement-workbench`
3. 选 **Public**
4. **不要**勾选 "Add a README file" / ".gitignore" / "License"（否则首次 push 会冲突）
5. 点 **Create repository**

### C2. 推送代码
仓库已初始化并有一个提交，直接执行（把 `<你的用户名>` 和 `<仓库名>` 换掉）：

```bash
cd D:\Workroom\hospital-info-requirement-workbench
git add -A
git commit -m "接入 Supabase：邮箱登录 + 多设备同步"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### C3. 开启 GitHub Pages
1. 仓库页面 → **Settings** → 左侧 **Pages**
2. **Source** 选 **Deploy from a branch**
3. **Branch** 选 `main`，目录选 **`/ (root)`** → **Save**
4. 等 1～3 分钟，刷新 Settings → Pages，顶部会出现访问地址：
   ```
   https://<你的用户名>.github.io/<仓库名>/
   ```

> 因为 `index.html` 在仓库根目录、`assets/` 用相对路径引用，
> Pages 的 `main + /(root)` 模式可以直接跑，无需任何构建。

---

## D. 线上地址（部署后填写）

| 项目 | 地址 |
|---|---|
| GitHub 仓库 | `https://github.com/<你的用户名>/<仓库名>` |
| **GitHub Pages 访问地址** | `https://<你的用户名>.github.io/<仓库名>/` |
| Supabase 项目 | `https://<项目ID>.supabase.co` |

填好这三项后，按 `VERIFY.md` 跑一遍验证清单。

---

## E. 【网络受限专用】github.com 被封锁时的免-git 发布方案

### E0. 先判断你是否属于这种情况

在 **CMD / PowerShell** 里执行：

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://github.com
curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://api.github.com
```

| 结果 | 含义 | 走哪条路 |
|---|---|---|
| 两个都 `200` | 网络正常 | 走上面的 A～C 常规流程 |
| `github.com` 超时、`api.github.com` 返回 `200` | **主站被封、API 通**（企业/医院网络常见） | 走本节 E 方案 |
| 两个都超时 | 整体不通 | 走 F 备选平台 |

### E1. 为什么网页登录会卡死

`github.com` 被 **SNI 级封锁**——已验证解析出的 IP（`20.205.243.166`、`140.82.112.4` 等）无一可用，
而同属 GitHub 的 `api.github.com`、`pages.github.com`、`raw.githubusercontent.com` 均可直连。
因此：**浏览器打开 github.com 必然转圈**，git 的 HTTPS / SSH（`github.com:22`、`ssh.github.com:443`）也全部超时，改 hosts 无效。

### E2. 解决思路

只用 `api.github.com` 完成「建仓库 → 传文件 → 开 Pages」，**不需要 git push，也不需要打开 github.com**。
唯一前提：你需要一个 **Personal Access Token（PAT）** —— 而创建 PAT 必须登录 github.com，
所以这一步请在**手机流量 / 家用网络**下完成，拿到 token 后回到本机即可。

### E3. 操作步骤

**第 1 步（换网络，一次性）**：用手机流量或家里电脑打开 github.com
→ 右上角头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
→ **Generate new token (classic)**
- Note：随意，如 `workbench-publish`
- Expiration：建议 `No expiration`
- 勾选 **`repo`**（建仓库/传文件必需）
- 点 **Generate** → **立刻复制 `ghp_` 开头的字符串**（关闭页面后无法再看）

**第 2 步（回到本机）**：在项目目录执行

```bash
cd D:\Workroom\hospital-info-requirement-workbench
set GITHUB_TOKEN=ghp_你刚才复制的token
node tools/gh-publish.js hospital-info-requirement-workbench
```

> PowerShell 用户用：`$env:GITHUB_TOKEN='ghp_xxx'` 然后 `node tools/gh-publish.js <仓库名>`

脚本会自动完成：校验 token → 建/复用仓库 → **逐个上传全部文件**（已存在则覆盖）→ 开启 Pages → 打印线上地址。
脚本幂等，重复执行安全。

**第 3 步**：等待 1～3 分钟，访问输出的 `https://<用户名>.github.io/<仓库名>/`。

### E4. 脚本已验证

- `node --check` 语法通过
- 实测可连通 `api.github.com` 并正确返回鉴权结果（假 token 得到 `401 Bad credentials`，证明链路完整，只差有效 token）

---

## F. 备选：彻底绕开 GitHub 的托管平台

若你拿不到 PAT 或不方便切网络，本应用是**纯静态**的，下面两个平台都实测可直连（HTTP 200），
支持直接上传文件夹拿到永久链接，**Supabase 部分完全不受影响，无需任何改动**：

| 平台 | 做法 | 地址形态 |
|---|---|---|
| **Cloudflare Pages** | dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets，把项目文件夹（除 `.git`）拖进去 | `https://<项目名>.pages.dev` |
| **Vercel** | vercel.com → Add New → Project → 拖拽上传，或 `npx vercel --prod` | `https://<项目名>.vercel.app` |

注意：换平台后记得在 Supabase 控制台的 **Authentication → URL Configuration** 里，
把新域名加入 **Site URL / Redirect URLs**，否则登录回调会被拒绝。

---

## 常见问题排查

| 现象 | 原因与处理 |
|---|---|
| Pages 404 / 打不开 | 确认 Pages 选的是 `main` + `/(root)`；确认 `index.html` 在仓库**根目录**；刚 Save 需等 1～3 分钟 |
| 页面能开但右下角显示「未配置 Supabase · 本地模式」 | `assets/config.js` 的占位符没替换干净；改完记得 **Ctrl/Cmd + F5 强刷**（浏览器会缓存旧 JS） |
| 登录报「网络错误」 | `url` 填错（多了/少了斜杠、写成 `https://supabase.com/dashboard`）；或免费项目闲置 7 天被暂停，去控制台 **Restore** |
| 登录报「邮箱或密码错误」 | 确认在 Authentication → Users 建了用户，且勾选了 **Auto Confirm User** |
| 登录报「邮箱尚未验证」 | 关闭 Email 提供者的 **Confirm email**，或去邮箱点确认链接 |
| 能登录但数据不出现 | SQL 没执行成功（6 张表不存在），或 RLS 策略缺失 → 重跑 `supabase/schema.sql` |
| 控制台 401 | token 过期且 refresh 也失败 → 重新登录即可；若持续出现，检查 Supabase 项目的 JWT 设置 |
| 改了 JS 没生效 | GitHub Pages 有 CDN 缓存，等 1～2 分钟，或 **Ctrl/Cmd + F5** 强刷 |
