# 端到端验证清单

部署完成后，按此清单逐项打勾。**建议按顺序执行**，前一步不过就不要往后走。

---

## 0. 前置检查

- [ ] GitHub Pages 地址能正常打开，出现登录页（中国风水墨背景）
- [ ] F12 打开控制台，页面加载后 **0 条红色报错**
- [ ] `assets/config.js` 已填入真实的 `url` 与 `anonKey`（右下角角标不显示「未配置 Supabase」）

---

## 1. 邮箱登录

- [ ] 输入在 Supabase 创建的邮箱 + 密码 → 登录成功，进入主界面
- [ ] 右上角显示的是你的邮箱（或昵称）
- [ ] 输入错误密码 → 提示「邮箱或密码错误」，**不进入**系统
- [ ] 输入非邮箱格式 → 提示「请输入有效的邮箱地址」

## 2. 刷新不掉登录态（会话恢复）

- [ ] 登录后按 **F5 刷新** → 仍在主界面，**不跳回登录页**
- [ ] 关闭标签页，重新打开 Pages 地址 → 仍是登录态
- [ ] F12 → Application → Local Storage → 能看到 `hirw_sb_session`（含 access_token / refresh_token）

## 3. Token 过期自动续期

- [ ] 在控制台执行下面这行，把 token 人为改成「1 分钟后过期」：
  ```js
  const s=JSON.parse(localStorage.getItem('hirw_sb_session'));
  s.expires_at=Math.floor(Date.now()/1000)-1;
  localStorage.setItem('hirw_sb_session',JSON.stringify(s));
  ```
- [ ] 刷新页面 → 应用应**自动续期并正常进入**，不要求重新登录
- [ ] F12 → Network 里能看到一次 `grant_type=refresh_token` 请求返回 200
- [ ] Local Storage 中的 `access_token` 已更新为新的值

## 4. 新增 / 修改 / 删除 → 云端落库

- [ ] 在「项目台账」新增一条需求 → 右下角角标先「同步中…」再变「已同步 时:分:秒」
- [ ] Supabase 控制台 **Table Editor → requirements** → 能看到刚新增的这条
- [ ] 该行的 `user_id` 等于你登录账号的 uid（**不是别人的**）
- [ ] 修改这条需求的「状态/计划日期」→ 云端对应行内容随之变化
- [ ] 删除这条需求 → 云端该行**消失**（差集删除生效）
- [ ] 生成一个周报归档 → `weekly_archives` 表出现对应行
- [ ] 生成一个年度总结 → `annual_archives` 表出现对应行

## 5. 多设备同步

- [ ] 换一个浏览器（或用无痕窗口 / 手机）打开同一个 Pages 地址
- [ ] 登录**同一账号** → 能看到设备 A 上创建的数据
- [ ] 在设备 B 修改一条需求 → 设备 A 刷新后能看到变化
- [ ] 两个设备的数据条数一致（无重复、无丢失）

## 6. 账号隔离 + 登出彻底清理 ⚠️ 重点

- [ ] 在 Supabase **Authentication → Users** 创建**第二个**用户
- [ ] 在设备 A 点「退出登录」
  - [ ] 页面立即回到登录页，主界面内容**空白**（未登录空数据态）
  - [ ] F12 → Application → Local Storage：
    - [ ] `hirw_sb_session` **已清除**
    - [ ] `v2_requirements` / `v2_users` / `v2_logs` / `v2_weekly` / `v2_annual` / `v2_vocab` **已清除**
    - [ ] `v2_session` **已清除**
  - [ ] 控制台执行 `window.Cloud.session` → 应为 `null`；`G.user` → 应为 `null`
- [ ] 用**账号 B** 登录 → **看不到账号 A 的任何数据**（空或只有 B 自己的）
- [ ] 账号 B 创建一条测试数据
- [ ] 登出 → 用**账号 A** 登录 → A 的数据完整回来，且**看不到 B 的数据**
- [ ] Supabase 控制台查 `requirements` 表：两个账号的行 `user_id` 不同，互不可见

## 7. 刷新与离线

- [ ] 断网后修改数据 → 不报错，数据保留在本地（角标显示「同步失败，将自动重试」）
- [ ] 恢复网络后再次修改 → 自动重试成功，云端补齐

## 8. 控制台零报错

- [ ] 完整走完上面 1～7 步，F12 Console **始终 0 条红色错误**
- [ ] Network 中**无持续失败的 401 / 403**
- [ ] 无 `Uncaught ReferenceError` / `TypeError`

## 9. 自动化回归

```bash
cd D:\Workroom\hospital-info-requirement-workbench
node tests/sb-client.smoke.js
```

- [ ] 输出 `SB_CLIENT_SMOKE_PASS (22 项全部通过)`
  - 覆盖：请求构造 / upsert 幂等 / 204 空响应 / 空数组 / 401 自动续期重试一次 /
    续期失败清空会话 / 超时转 408 / 登录登出

---

## 已规避的坑（对照确认）

| 坑 | 规避方式 | 验证位置 |
|---|---|---|
| 主键 ID 类型与前端生成格式不一致 | `uid()` 改为 `crypto.randomUUID()`（非安全上下文有回退），建表主键为 `uuid` | 第 4 步：云端 `id` 为标准 UUID；旧 `r` 前缀数据在登录时自动迁移 |
| Token 过期与续期 | 提前 60s 判定过期；401 时自动用 refresh_token 续期并**只重试一次**；refresh 失效才清会话 | 第 3 步 |
| 并发写入冲突 | debounce 800ms 合并 + Promise 串行队列 + upsert 按 id 幂等合并 + 失败指数退避重试 3 次 | 第 4/5 步：无重复行 |
| 登出清理不彻底 | 清 token + 清全部业务键 + 重置 `G` / `logs` 全局状态 + 清空 `#main` 并重绘登录页 | 第 6 步 |
| 多设备重复示例数据 | 云端有数据时以云端为准，丢弃本设备本地孤立行（仅当该表无未推送改动时） | 第 5 步：条数一致、无重复 |
