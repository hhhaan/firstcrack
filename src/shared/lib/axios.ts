import axios from 'axios'
import { supabase } from './supabase'

const SUPABASE_URL = 'https://vjdgdolfxvnxushxrmff.supabase.co'
const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZGdkb2xmeHZueHVzaHhybWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzMyNjMsImV4cCI6MjA5MjUwOTI2M30.4NR4k6sz72AEa_-oFc8vGk_gfZlztNoBtUlDbz4SjA8'

export const supabaseAxios = axios.create({
    baseURL: `${SUPABASE_URL}/rest/v1`,
    headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
    },
})

supabaseAxios.interceptors.request.use(async (config) => {
    const {
        data: { session },
    } = await supabase.auth.getSession()
    if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`
    }
    return config
})
