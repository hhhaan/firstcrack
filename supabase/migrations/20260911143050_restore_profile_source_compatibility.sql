-- Releases before 1.2.0 support manual profiles and send NULL here. Keep those
-- installed clients write-compatible while current clients require a session in UI.
-- Reapply NOT NULL only after releases before 1.2.0 are no longer supported.
ALTER TABLE public.roast_profiles
  ALTER COLUMN source_session_id DROP NOT NULL;
