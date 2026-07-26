-- 실측 배출량(로스팅 후 무게). weight_grams는 생두 투입량(batch_size_kg 프리필 · 생두 재고 차감 기준)이므로 건드리지 않는다.
-- null = 미입력(과거 세션) → 감량률은 DEFAULT_SHRINK_FACTOR 추정으로 폴백.
alter table public.roast_sessions
    add column if not exists output_weight_grams integer
        check (output_weight_grams is null or (output_weight_grams > 0 and output_weight_grams <= weight_grams));

comment on column public.roast_sessions.weight_grams is '생두 투입량(g) — 재고 차감 기준';
comment on column public.roast_sessions.output_weight_grams is '실측 배출량(g) — null이면 감량률 추정 폴백';
