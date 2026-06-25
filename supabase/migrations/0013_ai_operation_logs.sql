-- 0013: AI/Codex natural-language operation audit log
-- The app still applies changes through server-side admin APIs only; this table records
-- each interpreted request, preview, approval, apply result, and drift/failure.
create table if not exists ai_operation_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null default 'admin' check (actor in ('admin', 'system')),
  source text not null default 'admin_console' check (source in ('admin_console', 'api', 'codex', 'claude_code')),
  request_text text not null default '',
  operation_type text not null,
  status text not null default 'previewed'
    check (status in ('previewed', 'applied', 'failed', 'cancelled')),
  preview jsonb not null default '{}'::jsonb,
  applied_result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists idx_ai_operation_logs_created_at
  on ai_operation_logs (created_at desc);
create index if not exists idx_ai_operation_logs_status
  on ai_operation_logs (status);
create index if not exists idx_ai_operation_logs_operation_type
  on ai_operation_logs (operation_type);

alter table ai_operation_logs enable row level security;
