import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSupabaseClient } from '../lib/supabase/client'
import { Env, getEnv } from './env'
import { SupabaseClient } from '@supabase/supabase-js'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'

declare module 'hono' {
  interface HonoRequest {
    db: SupabaseClient<any, 'public', any>,
    env: Env
  }
}

const corsOptions = {
  origin: (origin: string) => {
    const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://magicteams.netlify.app']
    return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowCredentials: true,
  maxAge: 300,
}

const errorHandler = createMiddleware(async (c, next) => {
  try {
    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    console.error(error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

const injectEnv = createMiddleware(async (c, next) => {
  try {
    const env = getEnv(c.env)
    c.req.env = env;
    await next()
  } catch (error) {
    console.error("Loading Environment Variables Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

const injectDB = createMiddleware(async (c, next) => {
  const env = c.req.env;
  try {
    const supabase = getSupabaseClient(env)
    c.req.db = supabase;
    await next()
  } catch (error) {
    console.error("Loading Supabase Client Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  
  app.use('/*', cors(corsOptions))
  app.use('/*', errorHandler)
  app.use('/*', injectEnv)
  app.use('/*', injectDB)
  
  return app;
}
