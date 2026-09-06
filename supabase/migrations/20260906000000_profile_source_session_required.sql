-- #352 profile = session-derived. A profile is a label on one immutable roast session
-- (curve TSV + event marks); manually typed profiles no longer exist, so the source
-- session becomes mandatory and cannot be deleted from under a profile.
--
-- Fail-loud: SET NOT NULL errors if orphan rows exist. Prod had 0 nulls on 2026-09-06
-- (2 profiles, both with a source). Local/seed DBs with orphans must delete them first.

ALTER TABLE roast_profiles
  ALTER COLUMN source_session_id SET NOT NULL;

ALTER TABLE roast_profiles
  DROP CONSTRAINT roast_profiles_source_session_id_fkey,
  ADD CONSTRAINT roast_profiles_source_session_id_fkey
    FOREIGN KEY (source_session_id) REFERENCES roast_sessions(id) ON DELETE RESTRICT;
