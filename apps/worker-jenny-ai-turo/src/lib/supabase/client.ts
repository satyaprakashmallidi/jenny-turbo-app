import { createClient } from "@supabase/supabase-js"
import type { Env } from "../../config/env"

export function getSupabaseClient(env: Env) {
    
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Missing environment variables")
    }

    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    if(!client) {
        throw new Error("Failed to create Supabase client")
    }

    return client;
}