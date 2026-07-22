-- Enable RLS on all tables (idempotent)
ALTER TABLE public.beans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bean_inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to ensure idempotency
DROP POLICY IF EXISTS "Users can view own beans" ON public.beans;
DROP POLICY IF EXISTS "Users can insert own beans" ON public.beans;
DROP POLICY IF EXISTS "Users can update own beans" ON public.beans;
DROP POLICY IF EXISTS "Users can delete own beans" ON public.beans;

DROP POLICY IF EXISTS "Users can view own inventory logs" ON public.bean_inventory_logs;
DROP POLICY IF EXISTS "Users can insert own inventory logs" ON public.bean_inventory_logs;
DROP POLICY IF EXISTS "Users can update own inventory logs" ON public.bean_inventory_logs;
DROP POLICY IF EXISTS "Users can delete own inventory logs" ON public.bean_inventory_logs;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can view own roast profiles" ON public.roast_profiles;
DROP POLICY IF EXISTS "Users can insert own roast profiles" ON public.roast_profiles;
DROP POLICY IF EXISTS "Users can update own roast profiles" ON public.roast_profiles;
DROP POLICY IF EXISTS "Users can delete own roast profiles" ON public.roast_profiles;

DROP POLICY IF EXISTS "Users can view own roast sessions" ON public.roast_sessions;
DROP POLICY IF EXISTS "Users can insert own roast sessions" ON public.roast_sessions;
DROP POLICY IF EXISTS "Users can update own roast sessions" ON public.roast_sessions;
DROP POLICY IF EXISTS "Users can delete own roast sessions" ON public.roast_sessions;

DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can delete own subscriptions" ON public.subscriptions;

-- Policies for beans (user-owned)
CREATE POLICY "Users can view own beans" ON public.beans
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own beans" ON public.beans
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own beans" ON public.beans
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own beans" ON public.beans
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for bean_inventory_logs (user-owned)
CREATE POLICY "Users can view own inventory logs" ON public.bean_inventory_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inventory logs" ON public.bean_inventory_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inventory logs" ON public.bean_inventory_logs
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inventory logs" ON public.bean_inventory_logs
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for profiles (self only)
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can delete own profile" ON public.profiles
  FOR DELETE USING (auth.uid() = id);

-- Policies for roast_profiles (user-owned)
CREATE POLICY "Users can view own roast profiles" ON public.roast_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own roast profiles" ON public.roast_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own roast profiles" ON public.roast_profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own roast profiles" ON public.roast_profiles
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for roast_sessions (user-owned)
CREATE POLICY "Users can view own roast sessions" ON public.roast_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own roast sessions" ON public.roast_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own roast sessions" ON public.roast_sessions
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own roast sessions" ON public.roast_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for subscriptions (user-owned)
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions" ON public.subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions" ON public.subscriptions
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions" ON public.subscriptions
  FOR DELETE USING (auth.uid() = user_id);
