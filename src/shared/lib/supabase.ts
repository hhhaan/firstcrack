import { createClient } from '@supabase/supabase-js'
import type { Database } from '@shared/types/database.types'

const SUPABASE_URL = 'https://vjdgdolfxvnxushxrmff.supabase.co'
const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZGdkb2xmeHZueHVzaHhybWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzMyNjMsImV4cCI6MjA5MjUwOTI2M30.4NR4k6sz72AEa_-oFc8vGk_gfZlztNoBtUlDbz4SjA8'

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
