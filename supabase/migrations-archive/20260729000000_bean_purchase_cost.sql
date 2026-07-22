-- 입고(purchase) 이벤트별 kg당 매입원가 기록.
-- 누적(가중평균/총매입액)은 파생 쿼리로 계산:
--   sum(delta_grams * cost_per_kg) / sum(delta_grams)
--   WHERE event_type = 'purchase' AND cost_per_kg IS NOT NULL
ALTER TABLE bean_stock_events
  ADD COLUMN cost_per_kg numeric CHECK (cost_per_kg >= 0);
