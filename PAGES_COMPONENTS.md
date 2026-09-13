# 页面与组件清单（Pages & Components）· v2（P0 + P1 + P2 全交付）

> 导航完整定义在 `NAV_FULL`（11 项）。P0+P1+P2 共实装 **11 个页面**，无占位。

## 一、导航总览

| 分组 | 视图 key | 名称 | 状态 |
|---|---|---|---|
| 视图总览 | dashboard | 数据看板 | ✅ P1 实装 |
| | overview | 总览首页 | ✅ P1 实装 |
| | ledger | 项目台账 | ✅ P0 实装 |
| | kanban | 状态看板 | ✅ P0 实装 |
| | analytics | 统计分析 | ✅ P1 实装 |
| | gov | 数据治理 | ✅ P2 实装 |
| 数据归档 | weekly | 周报归档 | ✅ P2 实装 |
| | annual | 年度总结 | ✅ P2 实装 |
| 系统管理 | users | 用户管理 | ✅ P1 实装 |
| | logs | 操作日志 | ✅ P1 实装 |
| | settings | 系统设置 | ✅ P1 实装 |

路由逻辑：`setView(v)` → `refreshAll()`；`gov/weekly/annual` 现已路由到真实视图（`viewGov`/`viewWeekly`/`viewAnnual`），不再走 `comingSoon`。

---

## 二、P0 实装页面

### 1. 项目台账 `ledger`（viewLedger）
范围切换（全部/信息需求/数据统计）+ 关键词/年度/状态/科室/优先级筛选 + 列设置（COLS 持久化 `v2_col_ledger`）+ 批量选择/删除/导出 + 分页(per=20) + 行→详情抽屉。

### 2. 状态看板 `kanban`（viewKanban）
四列（待办/进行中/已完成/已关闭）拖拽换状态（`changeStatus` 写日志 + 可撤销 toast）+ 逾期置顶 + 完成/关闭仅查看。

---

## 三、P1 实装页面

### 1. 总览首页 `overview`（viewOverview）
「今天要处理」：`notifyItems()` 聚合逾期 + 今日到期，点行 → `viewDetail(id,true)`。KPI 卡 `kpiGrid(c)`。近期动态取 `logs` 前 8 条。

### 2. 数据看板 `dashboard`（viewDashboard）
月度趋势 `svgTrend`（当年提交/完成双折线）+ 状态环图 `svgDonut` + 优先级 CSS 条形 `svgBars`。

### 3. 统计分析 `analytics`（viewAnalytics）
年份筛选（`#anaYear`，`G.anaYear`）+ 导出当前结果 CSV（`data-aexport` → `analyticsExport`）。多维聚合 `countBy`：按科室/类别/类型/优先级。

### 4. 操作日志 `logs`（viewLogs）
列表（时间/用户/动作/对象/结果）+ 年份筛选（`#logYear`）+ 清空（`data-logclear` 二次确认）。

### 5. 用户管理 `users`（viewUsers）
表格 + 新增（`data-useradd`）/编辑（`data-useredit`）/重置密码（`data-userreset`）/删除（`data-userdel`）。守卫：不可删当前账户；删除后至少 1 名 admin。`saveUser` 账号查重 + `hashPW` + 写 `v2_users` + `addLog`。

### 6. 系统设置 `settings`（viewSettings）
`data-backup`（导出全量 JSON）/ `data-import`（触发 `#importFile` → `doImport`）/ `data-cleardata`（清空全部 + 恢复演示数据，二次确认）。

---

## 四、P2 实装页面

### 1. 数据治理 `gov`（viewGov）
- **DAMA 六维质量评分卡**（`damaScores()` 实时计算，基于当前 `requirements`）：
  - 完整性：编号/描述/部门/计划日期 等关键字段齐全度
  - 准确性：类别命中标准枚举 + 部门命中受控词表（无词表时退化为非空）
  - 及时性：已完成按期交付 / 进行中不逾期
  - 一致性：类型专属必填齐备（DS 提交人/风险，RQ 业务系统）
  - 唯一性：编号无重复
  - 有效性：状态/阶段/优先级/年度 取值合规
  - 每维 0–100 分，≥85 绿 / 60–84 缃金 / <60 朱砂（`.q-ok/.q-warn/.q-bad` + `.qs .bar i.*`）
- **受控词表 CRUD**（`v2_vocab`）：
  - `openVocabForm(id)` / `saveVocab(id)`（账号查重，写日志）/ `deleteVocab(id)`（二次确认）
  - `data-vocabadd` / `data-vocabedit` / `data-vocabdel` 委托
  - 首次打开由 `seedVocab()` 种子（科室/类别样例），用于准确性校验

### 2. 周报归档 `weekly`（viewWeekly）
- 周期选择：`weekRangeOptions()` 生成近 12 周（`#wkSel`，`G.wkSel`，ISO 周编号，周一~周日）
- 实时预览 `weeklyStats(start,end)`：新提交/本周完成/进行中/逾期 + 按类别分布（`svgBars`）
- 一键生成归档 `genWeekly()`（写 `v2_weekly` + `addLog`，同周重复则更新）
- 归档列表：查看 `viewWeeklyArc(id)`（抽屉）/ 删除 `deleteWeekly(id)`（二次确认）

### 3. 年度总结 `annual`（viewAnnual）
- 年度选择：`#anaYear`（`G.anaYear`，复用 `yearOpts`）
- 实时全景 `annualStats(year)`：总数/已完成/完成率/逾期/跨年长尾/敏感 + 按状态/类别条形 + 平均历时
- 一键生成归档 `genAnnual()`（写 `v2_annual` + `addLog`，同年重复则更新）
- 归档列表：查看 `viewAnnualArc(id)`（抽屉）/ 删除 `deleteAnnual(id)`（二次确认）

---

## 五、共用组件 / 函数

| 组件/函数 | 作用 |
|---|---|
| `refreshAll()` | 唯一刷新入口：按序调用 topbar/sidebar/content 渲染 |
| `bindGlobal()` | document 事件委托（click/input/change/keydown/drag*），一次绑定 |
| `openDrawer`/`closeDrawer` | 详情/编辑/表单/归档查看抽屉 |
| `confirmBox`/`cfClose` | 二次确认弹层（`CF.yes` 回调）|
| `toast(msg,undoFn)` | 顶部轻提示，可带撤销 |
| `notifyItems`/`renderNotify` | 顶部「今天要处理」通知 |
| `recordForm`/`collectForm`/`saveReq`/`openEdit`/`openNew` | 需求表单与保存（含 `addLog`）|
| `viewDetail(id,canEdit)` | 详情抽屉（含相关日志）|
| `diffOf`/`changeStatus`/`deleteReq`/`batchDelete`/`batchExport` | 台账/看板操作 |
| `exportCSV`/`exportAllJSON`/`download`/`doImport` | 导入导出（doImport 已映射全部 7 表）|
| `migrateOldData`/`ensureSeed`/`seedVocab` | v1 迁移 + 示例种子 + 受控词表种子 |
| `icon`/`IC` | 内联手写 SVG 图标（含 gov/weekly/annual）|
| `svgTrend`/`svgDonut`/`svgBars`/`kpiGrid`/`kpi`/`roleBadge`/`yearOpts` | 图表与小组件（内联 SVG / CSS）|
| `damaScores`/`scoreLevel`/`weekRangeOptions`/`weeklyStats`/`annualStats` | P2 计算层 |
| `badge` 系列 | 状态/类型/优先级/风险徽标 |

---

## 六、数据层与计算层（单向）

```
loadArr/saveArr (store)
  → deriveRow (计算字段: overdue/elapsedDays/dueInDays)
  → scopeRows (按 G.scope) / countBy (聚合)
  → computeCounts (口径统计) / notifyItems (通知)
  → damaScores / weeklyStats / annualStats (P2 治理与归档计算)
  → viewOverview/viewDashboard/viewAnalytics/viewGov/viewWeekly/viewAnnual/viewLogs/viewUsers/viewSettings (渲染 HTML 字符串)
  → refreshAll (统一写入 DOM)
```

**铁律**：渲染函数（view*/render*）之间**不互调**；任何交互 → 改数据 → `refreshAll()`。

---

## 七、回归说明

> 各批次（P0~P4）的回归冒烟脚本为开发期一次性迭代工具，已随仓库清理移除，未随仓库发布。
> 各阶段覆盖：P0（9 项：初始化/种子/口径/计算字段/台账/看板/v1迁移/addLog/登录）、P1（21 项：8 实装视图 + P2 占位渲染、SVG 图表、统计筛选/导出、日志清空、用户增删改/重置、JSON 恢复、清空数据）、P2（17 项：gov+DAMA、受控词表 CRUD、weekly/annual 生成归档/查看/删除、全 11 视图无回归、全量导出）、P4（15 项：背景层/时间轴/全屏/导出/富文本）。全部全绿，无回归。

---

## 附：P3 优化增量（2026-09-13）

- **主题贯穿**：保留原令牌体系（`--r-card`/`--r-pill` + 中国风色板），新增全站薄云纹背景（≤6% 透明度），登录/顶栏朱砂印章与页头图标印章盒统一为印章视觉语言。
- **数据看板（首页）重写**：
  - 顶部「聚合通知」条（逾期/今日到期/进行中），可折叠。
  - 行动中心：左「今日聚焦」大卡（点行开抽屉）+ 右「运行红绿灯」三灯（点击下钻）。
  - 核心效能 KPI（异常值阈值变色）。
  - 多维分析三 Tab：趋势（月度双线）/ 分布（状态+类型环）/ 优先级·科室（双条形）。
  - 待办标准表：表头排序 + 状态筛选 + 行点抽屉。
- **总览KPI 升级**：4 主卡 + 「收起次要指标」折叠；近 7 日双轴面积图；DAMA 六维摘要条（点进数据治理）。
- **周报/年度**：生成归档前新增可编辑「叙述/备注」textarea，随归档存 `narrative`，查看归档时回显（保留换行）。
- **新增函数**：`svgAreaDual` / `ragCard` / `dashTodoHtml` / `damaBarHtml` / `last7Series` / `openLedgerFilter`；新增委托 `data-dashtab`/`data-banner`/`data-ovsec`/`data-rag`/`data-dsort` 与 `dashF` 变更。

---

## 附：P4 增量（2026-09-13）
- **背景**：`body::after` 内联 SVG 水墨远山/淡月/云霭/竹枝（透明度 ~10%，z-index:-2），与 `body::before` 宣纸云纹叠加；卡片暖白底保证可读；`cover center / cover` 响应式。
- **周报**：归档列表 → `weeklyTimelineHtml`（时间轴）；抽屉 foot 增加 `data-dfull`(全屏)/`data-doc`(Word)/`data-pdf`(PDF)；列表 `data-wkexport` 一键导出。
- **年度**：归档列表 → `annualCoverHtml`（中式封面卡）；抽屉 foot 全屏/导出；新增 `openAnnualEditor`（全屏富文本模态：模板/插入图表/加粗/标题/列表）+ `G.anNarrHtml` 暂存；叙述存 HTML 并 `renderRich` 回显。
- **导出**：`exportDoc`（生成带中文排版的 `.doc`）+ `exportPDF`（构建 `#printArea` 并 `window.print()`，`@media print` 仅显示打印区）；`sanitizeRich`/`richToText`/`narrFromInput` 安全处理。
- **新增图标**：`full` / `doc` / `pdf`。
