import { z } from "zod";

const envSchema = z.object({
    SUPABASE_URL: z.string(),
    SUPABASE_ANON_KEY: z.string(),
    APP_URL: z.string(),
    ULTRAVOX_API_KEY: z.string(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
});

export interface Env {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    APP_URL: string;
    ULTRAVOX_API_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
}

export function getEnv(env: Env) {
    const result = envSchema.safeParse(env);
    if (!result.success) {
        console.error("Invalid environment variables", result.error.format());
        throw new Error("Invalid environment variables");
    }
    return result.data;
}