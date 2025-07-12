import { z } from "zod";

interface ExecutionContext {
    // Add properties of ExecutionContext if needed
}

const envSchema = z.object({
    SUPABASE_URL: z.string(),
    SUPABASE_ANON_KEY: z.string(),
    APP_URL: z.string(),
    ULTRAVOX_API_KEY: z.string(),
    ULTRAVOX_API_URL: z.string().default('https://api.ultravox.ai/api'),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
    SUPABASE_KEY: z.string().optional(),
    executionCtx: z.any().optional(),
    ACTIVE_CALLS: z.any().optional(),
});

export interface Env {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    APP_URL: string;
    ULTRAVOX_API_KEY: string;
    ULTRAVOX_API_URL: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_KEY?: string;
    executionCtx?: ExecutionContext;
    ACTIVE_CALLS: KVNamespace;
    calls_que: Queue<any>; // Add this line for Cloudflare Queue binding
}

export function getEnv(env: any): Env {
    const result = envSchema.safeParse(env);
    if (!result.success) {
        console.error("Invalid environment variables", result.error.format());
        throw new Error("Invalid environment variables");
    }
    return {
        SUPABASE_URL: result.data.SUPABASE_URL,
        SUPABASE_ANON_KEY: result.data.SUPABASE_ANON_KEY,
        APP_URL: result.data.APP_URL,
        ULTRAVOX_API_KEY: result.data.ULTRAVOX_API_KEY,
        ULTRAVOX_API_URL: result.data.ULTRAVOX_API_URL,
        GOOGLE_CLIENT_ID: result.data.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: result.data.GOOGLE_CLIENT_SECRET,
        SUPABASE_SERVICE_ROLE_KEY: result.data.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_KEY: result.data.SUPABASE_KEY,
        executionCtx: result.data.executionCtx,
        ACTIVE_CALLS: result.data.ACTIVE_CALLS,
        calls_que: (env.calls_que as any), // Add this line for the queue binding
    };
}