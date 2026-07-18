-- BBP (Between Batch Protocol): 이전 드롭 → 이 세션 charge까지의 배치간 기록.
-- 커브 원본은 R2 TSV(bbp_tsv_path), DB에는 요약값만 (기존 tsv_path/drop_temp 패턴과 동일).
alter table public.roast_sessions
    add column bbp_tsv_path text,
    add column bbp_seconds integer,
    add column charge_temp_celsius numeric;
