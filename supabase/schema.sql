-- ============================================================================
-- 医院信息需求管理工作台 · Supabase (PostgreSQL) 建表 + RLS + 索引
-- ----------------------------------------------------------------------------
-- 设计约定
--   1. 每张业务表主键 id 为 uuid，与前端 uid() 生成的 UUID v4 完全一致
--      （前端不再使用旧的 "r"+base36 短 ID，见 index.html 中 uid() 改造）。
--   2. user_id 为外键，引用 auth.users(id)，删除用户时级联清理。
--   3. RLS 全部开启，读写策略统一为：auth.uid() = user_id
--      （for all + using + with check，覆盖 SELECT/INSERT/UPDATE/DELETE）。
--   4. modified_at 由客户端在每次写入时带上（ISO 时间戳），用于多端
--      最后写入胜出（last-write-wins）的冲突判定。
--   5. created_at / updated_at 为 text：前端这两个字段存的是 nowHM() 产生的
--      展示用字符串（如 "09-13 23:45"），不是 ISO 时间，故不转 timestamptz，
--      避免解析失败。真正的同步时间戳用 modified_at。
--
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴本文件 → Run
-- 本脚本可重复执行（create if not exists / drop policy if exists）。
-- ============================================================================


-- ============================================================================
-- 1. 信息需求 / 数据统计（单一数据源）
-- ============================================================================
create table if not exists public.requirements (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  code         text        not null default '',
  type         text        not null default 'RQ',          -- RQ | DS
  year         text                 default '',
  priority     text                 default '中',           -- 高/中/低
  category     text                 default '',
  dept         text                 default '',
  submitter    text                 default '',
  systems      jsonb       not null default '[]'::jsonb,    -- 关联业务系统数组
  risk         text                 default '低',           -- 低/中/高/敏感
  sensitive    boolean     not null default false,
  desc_text    text                 default '',             -- 前端 desc（desc 是 SQL 保留字，改名）
  plan_text    text                 default '',             -- 前端 plan（plan 是关键字，改名）
  status       text                 default '待办',
  phase        text                 default '需求受理',
  submit_date  date,
  plan_date    date,
  done_date    date,
  cross_year   boolean     not null default false,
  remark       text                 default '',
  created_at   text                 default '',
  updated_at   text                 default '',
  modified_at  timestamptz not null default now()
);

create index if not exists idx_req_user         on public.requirements(user_id);
create index if not exists idx_req_user_status  on public.requirements(user_id, status);
create index if not exists idx_req_user_year    on public.requirements(user_id, year);
create index if not exists idx_req_user_plan    on public.requirements(user_id, plan_date);


-- ============================================================================
-- 2. 应用内用户花名册（原「用户管理」页；登录已由 Supabase Auth 接管，
--    此表仅作团队成员名录同步，不再是认证源）
-- ============================================================================
create table if not exists public.app_users (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  account     text    not null default '',
  name        text             default '',
  urole       text             default 'viewer',   -- admin|editor|viewer（role 为保留字族，改名）
  enabled     boolean not null default true,
  pass        text             default '',         -- 遗留字段：本地口令哈希，仅作花名册展示
  modified_at timestamptz not null default now()
);

create index if not exists idx_appusers_user on public.app_users(user_id);


-- ============================================================================
-- 3. 操作日志
-- ============================================================================
create table if not exists public.logs (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  op_time     text             default '',   -- 前端 time（展示字符串）
  who         text             default '',   -- 前端 user（user 是保留字，改名）
  action      text             default '',
  object_type text             default '',
  object_id   text             default '',
  diff        jsonb,
  result      text             default '成功',
  modified_at timestamptz not null default now()
);

create index if not exists idx_logs_user     on public.logs(user_id);
create index if not exists idx_logs_user_time on public.logs(user_id, op_time);


-- ============================================================================
-- 4. 周报归档
-- ============================================================================
create table if not exists public.weekly_archives (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_key    text             default '',   -- 前端 key（key 为保留字族，改名）
  label       text             default '',
  start_date  date,
  end_date    date,
  year        text             default '',
  week_no     text             default '',   -- 前端 week
  author      text             default '',   -- 前端 by（by 是保留字，改名）
  stats       jsonb            not null default '{}'::jsonb,
  narrative   text             default '',
  created_at  text             default '',
  modified_at timestamptz not null default now()
);

create index if not exists idx_weekly_user on public.weekly_archives(user_id);
create index if not exists idx_weekly_key  on public.weekly_archives(user_id, week_key);


-- ============================================================================
-- 5. 年度总结归档
-- ============================================================================
create table if not exists public.annual_archives (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  year        text             default '',
  author      text             default '',
  stats       jsonb            not null default '{}'::jsonb,
  narrative   text             default '',   -- 富文本 HTML（前端已做 sanitizeRich）
  created_at  text             default '',
  modified_at timestamptz not null default now()
);

create index if not exists idx_annual_user on public.annual_archives(user_id);
create index if not exists idx_annual_year on public.annual_archives(user_id, year);


-- ============================================================================
-- 6. 受控词表（数据治理）
-- ============================================================================
create table if not exists public.vocabularies (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  cat         text             default '',
  term        text             default '',
  descr       text             default '',   -- 前端 desc
  created_at  text             default '',
  modified_at timestamptz not null default now()
);

create index if not exists idx_vocab_user on public.vocabularies(user_id);
create index if not exists idx_vocab_cat  on public.vocabularies(user_id, cat);


-- ============================================================================
-- 7. Row Level Security —— 读写策略统一 auth.uid() = user_id
-- ============================================================================
alter table public.requirements     enable row level security;
alter table public.app_users        enable row level security;
alter table public.logs             enable row level security;
alter table public.weekly_archives  enable row level security;
alter table public.annual_archives  enable row level security;
alter table public.vocabularies     enable row level security;

-- requirements
drop policy if exists own_rows_requirements on public.requirements;
create policy own_rows_requirements on public.requirements
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- app_users
drop policy if exists own_rows_app_users on public.app_users;
create policy own_rows_app_users on public.app_users
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- logs
drop policy if exists own_rows_logs on public.logs;
create policy own_rows_logs on public.logs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- weekly_archives
drop policy if exists own_rows_weekly_archives on public.weekly_archives;
create policy own_rows_weekly_archives on public.weekly_archives
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- annual_archives
drop policy if exists own_rows_annual_archives on public.annual_archives;
create policy own_rows_annual_archives on public.annual_archives
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- vocabularies
drop policy if exists own_rows_vocabularies on public.vocabularies;
create policy own_rows_vocabularies on public.vocabularies
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================================
-- 8. 授权（RLS 已在行级兜底，这里放开 authenticated 的 DML）
-- ============================================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.requirements    to authenticated;
grant select, insert, update, delete on public.app_users       to authenticated;
grant select, insert, update, delete on public.logs            to authenticated;
grant select, insert, update, delete on public.weekly_archives to authenticated;
grant select, insert, update, delete on public.annual_archives to authenticated;
grant select, insert, update, delete on public.vocabularies    to authenticated;


-- ============================================================================
-- 9. 自检查询（可选，确认 RLS 与表已就绪）
-- ============================================================================
-- select tablename, rowsecurity from pg_tables
--  where schemaname='public'
--    and tablename in ('requirements','app_users','logs',
--                      'weekly_archives','annual_archives','vocabularies');
--   → 期望 rowsecurity 全部为 t
--
-- select tablename, policyname, cmd from pg_policies where schemaname='public';
--   → 期望 6 条 own_rows_* 策略，cmd = ALL
