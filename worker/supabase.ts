import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient(env: Env) {
    return createClient(
        env.SUPABASE_URL,
        env.SUPABASE_PUBLISHABLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false,
            },
        },
    )
}