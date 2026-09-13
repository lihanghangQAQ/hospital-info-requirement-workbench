/* =====================================================================
 * Supabase 连接配置 —— 部署前唯一需要你手工填写的文件
 * ---------------------------------------------------------------------
 * 取值位置：Supabase 控制台 → Project Settings → API
 *   · Project URL       → 填到 url
 *   · anon / public key → 填到 anonKey
 *
 * 安全性说明：anon key 的设计就是「可以出现在公开的前端代码里」，
 * 它本身不代表任何权限；真正的读写边界由数据表上的 RLS 策略
 * （auth.uid() = user_id）来保证。因此把它提交到公开仓库是安全的。
 * 切勿填写 service_role key。
 * ===================================================================== */
window.SB_CONFIG = {
  url: "https://nphafpbqhgzxygapsffj.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5waGFmcGJxaGd6eHlnYXBzZmZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyNjI1MzAsImV4cCI6MjEwNDgzODUzMH0.7PS7jmMvRqgavak50vaH_4lOl4r9SMDjNbJnP4IBcdQ",

  // 单个请求超时（毫秒），超时会抛 status=408
  timeoutMs: 15000
};
