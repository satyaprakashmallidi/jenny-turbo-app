import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type { Env } from "../../config/env"

class SupabaseService {
    private static instance: SupabaseService;
    private client: SupabaseClient | null = null;
    private env: Env | null = null;

    private constructor() {}

    public static getInstance(): SupabaseService {
        if (!SupabaseService.instance) {
            SupabaseService.instance = new SupabaseService();
        }
        return SupabaseService.instance;
    }

    public initializeClient(env: Env): SupabaseClient {
        if (this.client && this.env === env) {
            return this.client;
        }

        const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

        if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error("Missing environment variables")
        }

        this.client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });

        if(!this.client) {
            throw new Error("Failed to create Supabase client")
        }

        this.env = env;
        return this.client;
    }
}

export const getSupabaseClient = (env: Env): SupabaseClient => {
    return SupabaseService.getInstance().initializeClient(env);
}