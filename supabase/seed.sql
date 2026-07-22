-- Local-only seed, applied by `supabase db reset` (config.toml [db.seed]).
-- Remote DB is never seeded from this file.

-- pg_dump skips the auth schema, so the baseline migration lacks this trigger
-- (remote already has it). Without it local signups never get a profiles row.
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
