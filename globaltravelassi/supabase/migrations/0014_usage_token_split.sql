-- 0014: input and output tokens for model usage, so each token type can be priced separately.
-- Additive only. Not applied to any database by the change that adds it: applying it needs owner approval.
-- Days recorded before this migration have a zero split. Their cost is shown as unknown, never estimated.

alter table public.ai_usage add column if not exists tokens_in int not null default 0 check (tokens_in >= 0);
alter table public.ai_usage add column if not exists tokens_out int not null default 0 check (tokens_out >= 0);
