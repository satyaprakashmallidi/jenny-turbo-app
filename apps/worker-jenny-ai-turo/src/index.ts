import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSupabaseClient } from './lib/supabase/client'
import { Env, getEnv } from './config/env'
import { SupabaseClient } from '@supabase/supabase-js'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { CallConfig, JoinUrlResponse, twilioData, ultravoxData } from '@repo/common-types/types'
import { ToolService } from './services/tool.service'
import { CreateToolRequest } from './types/tool.types'
import twilioRoutes from './routes/twilio.routes'
import { TwilioService } from './services/twilio.service'

//Caching Voices
let cachedVoices: any = null;
let lastCacheTime = 0;
const cacheDuration = 60 * 60 * 1000;

//creating a Hono JS Appplication with Envs
const app = new Hono<{ Bindings: Env }>();

const ULTRAVOX_API_BASE = 'https://api.ultravox.ai/api';

type WebhookEvent = string;
type CreateWebhookBody = {
  url?: string;
  events?: WebhookEvent[];
  agentId?: string | null;
  secrets?: string[];
  user_id?: string;
  agent_id?: string | null;
};

type UltravoxWebhookResponse = {
  webhookId: string;
  created: string;
  url: string;
  events: WebhookEvent[];
  status: 'normal' | 'unhealthy';
  lastStatusChange: string | null;
  recentFailures: Array<{ timestamp: string; failure: string }>;
  agentId: string | null;
  secrets: string[];
};

type ApiResponse<T> = {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  error?: unknown;
};


//Extend HonoRequest to Include SupaabaseClient
declare module 'hono' {
  interface HonoRequest {
    db: SupabaseClient<any, 'public', any>,
    env: Env
  }
}

//Enabling CORS
const corsOptions = {
  origin: (origin: string) => {
    const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://magicteams.netlify.app']
    
    return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowCredentials: true,
  maxAge: 300,// 5 minutes
}

//Error Handler
const errorHandler = createMiddleware(async (c, next) => {
  try {
    await next();
  }
  catch (error){
      if(error instanceof HTTPException){
        return error.getResponse();
      }

      console.error(error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
})

const injectEnv = createMiddleware(async (c, next) => {
  try{
    const env = getEnv(c.env)
    c.req.env = env;
    await next()
  }
  catch(error){
    console.error(" Loading Environment Variables Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

//Inject Database Client
const injectDB = createMiddleware(async (c, next) => {
  const env = c.req.env;
  try{
    const supabase = getSupabaseClient(env)
    c.req.db = supabase;
    await next()
  }
  catch(error){
    console.error("Loading Supabase Client Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

app.use('/*', cors(corsOptions))
app.use('/*', errorHandler)
app.use('/*', injectEnv)
app.use('/*', injectDB)

app.route('/api/twilio', twilioRoutes);

app.post('/api/webhooks', async (c) => {
  try {
    const body = await c.req.json<CreateWebhookBody>();
    const userId = body.user_id;
    const url = body.url?.trim();
    const events = body.events || [];
    const rawAgentId = body.agentId ?? null;
    const isUuid = (value: string | null) =>
      !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const dbAgentId = isUuid(body.agent_id ?? null)
      ? body.agent_id!
      : (isUuid(rawAgentId) ? rawAgentId : null);

    if (!userId || !url || events.length === 0) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing required fields: user_id, url, events',
      }, 400);
    }

    const ultraResponse = await fetch(`${ULTRAVOX_API_BASE}/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify({
        url,
        events,
        agentId: rawAgentId,
        secrets: body.secrets,
      }),
    });

    if (!ultraResponse.ok) {
      const errorText = await ultraResponse.text();
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Ultravox API error',
        error: errorText,
      }, 500);
    }

    const ultraData = await ultraResponse.json() as UltravoxWebhookResponse;

    const { data: dbRow, error } = await c.req.db
      .from('ultravox_webhooks')
      .upsert([{
        user_id: userId,
        ultravox_webhook_id: ultraData.webhookId,
        url: ultraData.url,
        events: ultraData.events,
        agent_id: dbAgentId,
        status: ultraData.status,
        last_status_change: ultraData.lastStatusChange,
        secret_key: ultraData.secrets?.[0] ?? null,
        recent_failures: ultraData.recentFailures ?? [],
      }], { onConflict: 'ultravox_webhook_id' })
      .select('*')
      .single();

    if (error) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to save webhook in database',
        error,
      }, 500);
    }

    return c.json<ApiResponse<any>>({
      status: 'success',
      data: {
        webhook_id: dbRow.webhook_id,
        created: ultraData.created || dbRow.created_at,
        url: dbRow.url,
        events: dbRow.events,
        status: dbRow.status,
        lastStatusChange: dbRow.last_status_change,
        recentFailures: dbRow.recent_failures || [],
        agentId: dbRow.agent_id,
        secrets: ultraData.secrets || [],
      },
    });
  } catch (error) {
    console.error('Create Webhook Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.get('/api/webhooks/user', async (c) => {
  try {
    const userId = c.req.query('user_id');
    const agentId = c.req.query('agent_id');

    if (!userId) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing user_id',
      }, 400);
    }

    let query = c.req.db
      .from('ultravox_webhooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;

    if (error) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to fetch webhooks',
        error,
      }, 500);
    }

    const results = (data || []).map((row: any) => ({
      webhook_id: row.webhook_id,
      created: row.created_at,
      url: row.url,
      events: row.events,
      status: row.status,
      lastStatusChange: row.last_status_change,
      recentFailures: row.recent_failures || [],
      agentId: row.agent_id,
      secrets: row.secret_key ? [row.secret_key] : [],
    }));

    return c.json<ApiResponse<{ next: null; previous: null; results: any[] }>>({
      status: 'success',
      data: {
        next: null,
        previous: null,
        results,
      },
    });
  } catch (error) {
    console.error('List Webhooks Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.patch('/api/webhooks/:webhookId', async (c) => {
  try {
    const webhookId = c.req.param('webhookId');
    const body = await c.req.json<CreateWebhookBody>();
    const userId = body.user_id;

    if (!webhookId || !userId) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing webhookId or user_id',
      }, 400);
    }

    const { data: existing, error: fetchError } = await c.req.db
      .from('ultravox_webhooks')
      .select('*')
      .eq('webhook_id', webhookId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Webhook not found',
        error: fetchError,
      }, 404);
    }

    if (!existing.ultravox_webhook_id) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing Ultravox webhook id',
      }, 400);
    }

    const rawAgentId = body.agentId ?? null;
    const updatePayload: Record<string, unknown> = {};
    if (body.url) updatePayload.url = body.url.trim();
    if (body.events) updatePayload.events = body.events;
    if (rawAgentId !== undefined) updatePayload.agentId = rawAgentId;
    if (body.secrets) updatePayload.secrets = body.secrets;

    const ultraResponse = await fetch(`${ULTRAVOX_API_BASE}/webhooks/${existing.ultravox_webhook_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify(updatePayload),
    });

    if (!ultraResponse.ok) {
      const errorText = await ultraResponse.text();
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Ultravox API error',
        error: errorText,
      }, 500);
    }

    const ultraData = await ultraResponse.json() as UltravoxWebhookResponse;

    const isUuid = (value: string | null) =>
      !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const dbAgentId = isUuid(body.agent_id ?? null)
      ? body.agent_id!
      : (isUuid(rawAgentId) ? rawAgentId : null);

    const { data: updated, error: updateError } = await c.req.db
      .from('ultravox_webhooks')
      .update({
        url: ultraData.url,
        events: ultraData.events,
        agent_id: dbAgentId,
        status: ultraData.status,
        last_status_change: ultraData.lastStatusChange,
        secret_key: ultraData.secrets?.[0] ?? null,
        recent_failures: ultraData.recentFailures ?? [],
      })
      .eq('webhook_id', webhookId)
      .select('*')
      .single();

    if (updateError) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to update webhook in database',
        error: updateError,
      }, 500);
    }

    return c.json<ApiResponse<any>>({
      status: 'success',
      data: {
        webhook_id: updated.webhook_id,
        created: ultraData.created || updated.created_at,
        url: updated.url,
        events: updated.events,
        status: updated.status,
        lastStatusChange: updated.last_status_change,
        recentFailures: updated.recent_failures || [],
        agentId: updated.agent_id,
        secrets: ultraData.secrets || [],
      },
    });
  } catch (error) {
    console.error('Update Webhook Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.delete('/api/webhooks/:webhookId', async (c) => {
  try {
    const webhookId = c.req.param('webhookId');
    const userId = c.req.query('user_id');

    if (!webhookId || !userId) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing webhookId or user_id',
      }, 400);
    }

    const { data: existing, error: fetchError } = await c.req.db
      .from('ultravox_webhooks')
      .select('*')
      .eq('webhook_id', webhookId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Webhook not found',
        error: fetchError,
      }, 404);
    }

    if (existing.ultravox_webhook_id) {
      const ultraResponse = await fetch(`${ULTRAVOX_API_BASE}/webhooks/${existing.ultravox_webhook_id}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': c.env.ULTRAVOX_API_KEY,
        },
      });

      if (!ultraResponse.ok) {
        const errorText = await ultraResponse.text();
        return c.json<ApiResponse<null>>({
          status: 'error',
          message: 'Ultravox API error',
          error: errorText,
        }, 500);
      }
    }

    const { error: deleteError } = await c.req.db
      .from('ultravox_webhooks')
      .delete()
      .eq('webhook_id', webhookId);

    if (deleteError) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to delete webhook from database',
        error: deleteError,
      }, 500);
    }

    return c.json<ApiResponse<{ success: true }>>({
      status: 'success',
      data: { success: true },
    });
  } catch (error) {
    console.error('Delete Webhook Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.post('/api/webhooks/sync', async (c) => {
  try {
    const userId = c.req.query('user_id');
    const forceRecreate = c.req.query('recreate') === 'true';

    if (!userId) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing user_id',
      }, 400);
    }

    const { data: rows, error } = await c.req.db
      .from('ultravox_webhooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to fetch webhooks from database',
        error,
      }, 500);
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ webhook_id: string; error: string }> = [];

    for (const row of rows || []) {
      if (row.ultravox_webhook_id && !forceRecreate) {
        skipped.push(row.webhook_id);
        continue;
      }

      try {
        const ultraResponse = await fetch(`${ULTRAVOX_API_BASE}/webhooks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': c.env.ULTRAVOX_API_KEY,
          },
          body: JSON.stringify({
            url: row.url,
            events: row.events,
          }),
        });

        if (!ultraResponse.ok) {
          const errorText = await ultraResponse.text();
          failed.push({ webhook_id: row.webhook_id, error: errorText });
          continue;
        }

        const ultraData = await ultraResponse.json() as UltravoxWebhookResponse;

        const { error: updateError } = await c.req.db
          .from('ultravox_webhooks')
          .update({
            ultravox_webhook_id: ultraData.webhookId,
            status: ultraData.status,
            last_status_change: ultraData.lastStatusChange,
            secret_key: ultraData.secrets?.[0] ?? null,
            recent_failures: ultraData.recentFailures ?? [],
          })
          .eq('webhook_id', row.webhook_id);

        if (updateError) {
          failed.push({ webhook_id: row.webhook_id, error: String(updateError) });
          continue;
        }

        created.push(row.webhook_id);
      } catch (err) {
        failed.push({ webhook_id: row.webhook_id, error: String(err) });
      }
    }

    return c.json<ApiResponse<{ created: string[]; skipped: string[]; failed: Array<{ webhook_id: string; error: string }> }>>({
      status: 'success',
      data: {
        created,
        skipped,
        failed,
      },
    });
  } catch (error) {
    console.error('Sync Webhooks Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.post('/api/webhooks/sync-all', async (c) => {
  try {
    const token = c.req.query('token');
    const forceRecreate = c.req.query('recreate') === 'true';

    if (!token || token !== c.env.WEBHOOK_SYNC_SECRET) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Unauthorized',
      }, 401);
    }

    const { data: rows, error } = await c.req.db
      .from('ultravox_webhooks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to fetch webhooks from database',
        error,
      }, 500);
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ webhook_id: string; error: string }> = [];

    for (const row of rows || []) {
      if (row.ultravox_webhook_id && !forceRecreate) {
        skipped.push(row.webhook_id);
        continue;
      }

      try {
        const ultraResponse = await fetch(`${ULTRAVOX_API_BASE}/webhooks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': c.env.ULTRAVOX_API_KEY,
          },
          body: JSON.stringify({
            url: row.url,
            events: row.events,
          }),
        });

        if (!ultraResponse.ok) {
          const errorText = await ultraResponse.text();
          failed.push({ webhook_id: row.webhook_id, error: errorText });
          continue;
        }

        const ultraData = await ultraResponse.json() as UltravoxWebhookResponse;

        const { error: updateError } = await c.req.db
          .from('ultravox_webhooks')
          .update({
            ultravox_webhook_id: ultraData.webhookId,
            status: ultraData.status,
            last_status_change: ultraData.lastStatusChange,
            secret_key: ultraData.secrets?.[0] ?? null,
            recent_failures: ultraData.recentFailures ?? [],
          })
          .eq('webhook_id', row.webhook_id);

        if (updateError) {
          failed.push({ webhook_id: row.webhook_id, error: String(updateError) });
          continue;
        }

        created.push(row.webhook_id);
      } catch (err) {
        failed.push({ webhook_id: row.webhook_id, error: String(err) });
      }
    }

    return c.json<ApiResponse<{ created: string[]; skipped: string[]; failed: Array<{ webhook_id: string; error: string }> }>>({
      status: 'success',
      data: {
        created,
        skipped,
        failed,
      },
    });
  } catch (error) {
    console.error('Sync All Webhooks Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.get('/api/webhooks/missing', async (c) => {
  try {
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Missing user_id',
      }, 400);
    }

    const { data, error } = await c.req.db
      .from('ultravox_webhooks')
      .select('*')
      .eq('user_id', userId)
      .is('ultravox_webhook_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Failed to fetch missing webhooks',
        error,
      }, 500);
    }

    return c.json<ApiResponse<any[]>>({
      status: 'success',
      data: data || [],
    });
  } catch (error) {
    console.error('Missing Webhooks Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.get('/api/webhooks/ultravox', async (c) => {
  try {
    const cursor = c.req.query('cursor');
    const pageSize = c.req.query('pageSize');
    const agentId = c.req.query('agentId');

    const params = new URLSearchParams();
    if (cursor) params.append('cursor', cursor);
    if (pageSize) params.append('pageSize', pageSize);
    if (agentId) params.append('agentId', agentId);

    const url = params.toString()
      ? `${ULTRAVOX_API_BASE}/webhooks?${params.toString()}`
      : `${ULTRAVOX_API_BASE}/webhooks`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json<ApiResponse<null>>({
        status: 'error',
        message: 'Ultravox API error',
        error: errorText,
      }, 500);
    }

    const data = await response.json();
    return c.json<ApiResponse<any>>({
      status: 'success',
      data,
    });
  } catch (error) {
    console.error('List Ultravox Webhooks Error:', error);
    return c.json<ApiResponse<null>>({
      status: 'error',
      message: 'Internal Server Error',
      error,
    }, 500);
  }
});

app.post('/api/ultravox/createcall' , async (c) => {
  
  try{
    const body = await c.req.json();
    console.log("Creating Ultravox Call Body",body);

    if(!c.env.ULTRAVOX_API_KEY){
      return c.json({
        status: 'error',
        message: 'UltraAgent API key',
      } , 500);
    }
    const response = await fetch('https://api.ultravox.ai/api/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify(body),
    });
    console.log("Creating Ultravox Call After call");

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultravox API error:", errorText);
      return c.json({
        status: 'error',
        message: 'Ultravox API error',
        error:  errorText ,
      } , 500);
    }

    const data  = await response.json();

    return c.json({
      status: 'success',
      data: data
    });

  }catch(error){
    console.error("Creating Ultravox Call",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
  
})

app.get('/api/ultravox/voices' , async (c) => {
  try{
    const now = Date.now();
    if(cachedVoices && now - lastCacheTime < cacheDuration){
      console.log("Returning Cached Voices");
      return c.json({
        status: 'success',
        data: cachedVoices
      });
    }

    const response = await fetch('https://api.ultravox.ai/api/voices', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText =  response.text();
      console.error("Ultravox API error:", errorText);
      return c.json({
        status: 'error',
        message: 'Ultravox API error',
      } , 500);
    }

    const data  = await response.json();
    
    //@ts-ignore
    const voices = data?.results?.map((voice: any) => {
      return {
        voiceId: voice.voiceId,
        name: voice.name,
        previewUrl: voice.previewUrl,
      }
    })

    cachedVoices = voices;
    lastCacheTime = now;

    return c.json({
      status: 'success',
      data: voices
    }); 

  }catch(error){
    console.error("Creating Ultravox Call",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
  
})

app.get('/api/voices' , async (c) => {
  try{
    const now = Date.now();
    if(cachedVoices && now - lastCacheTime < cacheDuration){
      console.log("Returning Cached Voices");
      return c.json({
        status: 'success',
        data: cachedVoices
      });
    }

    const response = await fetch('https://api.ultravox.ai/api/voices', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText =  response.text();
      console.error("Ultravox API error:", errorText);
      return c.json({
        status: 'error',
        message: 'Ultravox API error',
      } , 500);
    }

    const data  = await response.json();
    
    //@ts-ignore
    const voices = data?.results?.map((voice: any) => {
      return {
        voiceId: voice.voiceId,
        name: voice.name,
        previewUrl: voice.previewUrl,
      }
    })

    cachedVoices = voices;
    lastCacheTime = now;

    return c.json({
      status: 'success',
      data: voices
    }); 

  }catch(error){
    console.error("Creating Ultravox Call",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
  
})

app.post('/api/sendSummary' , async (c) => {

  try{
    
    const body = await c.req.json();  
    const supabase = getSupabaseClient(c.env);

    const callId = c.req.query('call_id');
    console.log("Recevied Summary Body",body , "Caaacac IDD " , callId);

    if(!callId){
      return c.json({
        status: 'error',
        message: 'Missing callId',
      } , 500);
    }

    const { data , error } = await supabase.from('summarys').upsert([
      { call_id: callId , summary: body?.conversationSummary }
    ], {
      onConflict: 'call_id'
    })

    console.log("Recevied Summary Body",body);

    if(error){
      console.error("Recevied Summary Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }

    return c.json({
      status: 'success',
      message: 'Received Summary',
    });
    

  }
  catch(error){
    console.error("Receiveing Summary Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }

})

app.get('/api/getSummary' , async (c) => {
  const callId = c.req.query('call_id');
  const supabase = getSupabaseClient(c.env);

  if(!callId){
    return c.json({
      status: 'error',
      message: 'Missing callId',
    } , 500);
  }

  const response = await fetch('https://api.ultravox.ai/api/calls/' + callId, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': c.env.ULTRAVOX_API_KEY,
    },
  });

  const twilioResp : {
    shortSummary: string;
  } = await response.json();

  if(twilioResp){
  
    await supabase.from('summarys').upsert([
      { call_id: callId , summary: twilioResp?.shortSummary  }
    ], {
      onConflict: 'call_id'
    })

  }

  const { data , error } = await supabase.from('summarys').select('*').eq('call_id' , callId);

  if(error){
    console.error("Recevied Summary Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }

  return c.json({
    status: 'success',
    data: data
  });
})

app.post('/api/add-call-to-db' , async (c) => {
  const body = await c.req.json();

  const { user_id , call_id , bot_id , placeholders } = body;
  const call_date = new Date().toISOString().split('T')[0];

  const supabase = getSupabaseClient(c.env);

  // Fetch existing record for the user and date
  const { data: existingData, error: fetchError } = await supabase
  .from('user_calls')
  .select('call_details')
  .eq('user_id', user_id)
  .eq('call_date', call_date)
  .single();

  let updatedCallDetails = [];

    if (existingData) {
      updatedCallDetails = existingData.call_details || [];
    } 
    updatedCallDetails.push(
      placeholders ?
      {[call_id]: {
        bot_id: bot_id,
        placeholders: placeholders
      }}
      :
      {[call_id]:  bot_id}
    );  // Append new call to array

    // Upsert updated data
    const { data, error } = await supabase
      .from('user_calls')
      .upsert([
        {
          user_id,
          call_date,
          call_details: updatedCallDetails,  // Updated call details array
        }
      ], { onConflict: 'user_id, call_date' });

    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ message: 'Call recorded successfully'});
  

})

app.get('/api/get-all-calls-of-user' ,async (c) => {
    try{

      const userId = c.req.query('user_id');
      const supabase = getSupabaseClient(c.env);

      if(!userId){
        return c.json({
          status: 'error',
          message: 'Missing user_id',
        } , 500);
      }

      const { data , error } = await supabase.from('user_calls').select('call_date , call_details').eq('user_id' , userId);
      if(error){
        console.error("Recevied Summary Error",error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error:  error ,
        } , 500);
      }

      return c.json({
        status: 'success',
        data: data
      });
    }
    catch(error){
      console.error("Receiveing Summary Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
})


app.get('/', async (c) => {
  const env = getEnv(c.env)
  const supabase = getSupabaseClient(env);

  const { data , error } = await supabase.from('summarys').upsert([
    { call_id: "54aaa19e-b1b2-4951-971a-b73c23025f0e" , summary: "this is testing the fucking api" }
  ], {
    onConflict: 'call_id'
  });

  if(error){
    console.error("Recevied Summary Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }


  return c.text('Hello Hono! ' + env.SUPABASE_URL)
})


app.post('/api/twilio/phone-number', async (c) => {
  try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    
    const body = await c.req.json()
    const { account_id, phone_number, friendly_name , user_id } = body

    if (!account_id || !phone_number || !friendly_name || !user_id) {
      return c.json({
        status: 'error',
        message: 'Missing parameters : account_id, phone_number, friendly_name, user_id',
      }, 500);
    }

    const { data: account, error: accountError } = await supabase
      .from('twilio_account')
      .select('id , user_id')
      .eq('id', account_id)
      .eq('user_id', user_id)
      .single();

    if (accountError) {
      console.error("Received /twilio/phone-number Error", accountError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error While Getting Account',
        error: accountError,
      }, 500);
    }

    if(!account) {
      return c.json({
        status: 'error',
        message: 'Account not found',
      }, 404);
    }
    
    if(account?.user_id !== user_id) {
      return c.json({
        status: 'error',
        message: 'Unauthorized',
      }, 401);
    }
    
    const { data, error } = await supabase
      .from('twilio_phone_numbers')
      .insert([{
        account_id,
        phone_number,
        friendly_name,
        is_active: true
      }])
      .select();

    if (error) {
      console.error("Received /twilio/phone-number Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }

    return c.json({
      status: 'success',
      data: data[0],
    })
  } catch(error) {
    console.error("Create Phone Number Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

app.patch('/api/twilio/phone-number/:id', async (c) => {
  try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id = c.req.param('id')
    const body = await c.req.json()
    const { phone_number, friendly_name , user_id } = body

    if (!phone_number || !friendly_name || !id || !user_id) {
      return c.json({
        status: 'error',
        message: 'Missing parameters : phone_number, friendly_name, user_id',
      }, 500);
    }

  let { data: accountDetails , error: accountDetailsError } = await supabase
    .from('twilio_phone_numbers')
    .select('id , account_id')
    .eq('id', id)
    .single();

  if (accountDetailsError) {
    console.error("Received /twilio/phone-number Error", accountDetailsError);
    return c.json({
      status: 'error',
      message: 'Internal Server Error While Getting Account',
      error: accountDetailsError,
    }, 500);
  }

  const { data: account, error: accountError } = await supabase
    .from('twilio_account')
    .select('id , user_id')
    .eq('id', accountDetails?.account_id)
    .single();

  if (accountError) {
    console.error("Received /twilio/phone-number Error", accountError);
    return c.json({
      status: 'error',
      message: 'Internal Server Error While Getting Account',
      error: accountError,
    }, 500);
  }

  if(!account) {
    return c.json({
      status: 'error',
      message: 'Account not found',
    }, 404);
  }
  
  if(account?.user_id !== user_id) {
    return c.json({
      status: 'error',
      message: 'Unauthorized',
    }, 401);
  }
  

    const { data, error } = await supabase
      .from('twilio_phone_numbers')
      .update({
        phone_number,
        friendly_name
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error("Received /twilio/phone-number/update Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }

    return c.json({
      status: 'success',
      data: data[0],
    })
  } catch(error) {
    console.error("Update Phone Number Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

app.delete('/api/twilio/phone-number/:id', async (c) => {
  try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id = c.req.param('id')

    const body = await c.req.json()
    const { user_id } = body;
    

  const {data : accountDetails , error: accountDetailsError } = await supabase
    .from('twilio_phone_numbers')
    .select('id , account_id')
    .eq('id', id)
    .single();

  if (accountDetailsError) {
    console.error("Received /twilio/phone-number Error", accountDetailsError);
    return c.json({
      status: 'error',
      message: 'Internal Server Error While Getting Account Details',
      error: accountDetailsError,
    }, 500);
  }

  if(!accountDetails) {
    return c.json({
      status: 'error',
      message: 'Account Details not found',
    }, 404);
  }

  const { data: account, error: accountError } = await supabase
    .from('twilio_account')
    .select('id , user_id')
    .eq('id', accountDetails?.account_id)
    .single();

  if (accountError) {
    console.error("Received /twilio/phone-number Error", accountError);
    return c.json({
      status: 'error',
      message: 'Internal Server Error While Getting Account',
      error: accountError,
    }, 500);
  }

  if(!account) {
    return c.json({
      status: 'error',
      message: 'Account not found',
    }, 404);
  }
  
  if(account?.user_id !== user_id) {
    return c.json({
      status: 'error',
      message: 'Unauthorized',
    }, 401);
  }
  
    const { data, error } = await supabase
      .from('twilio_phone_numbers')
      .update({
        is_active: false
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error("Received /twilio/phone-number/delete Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }

    return c.json({
      status: 'success'
    })
  } catch(error) {
    console.error("Delete Phone Number Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

app.post('/api/tools', async (c) => {
  try {
    const env = getEnv(c.env);
    const body = await c.req.json() as CreateToolRequest;
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }
    
    // Validate tool name length
    if (!body.name || body.name.length > 40) {
      return c.json(
        { error: "Tool name is required and must not exceed 40 characters" },
        { status: 400 }
      );
    }

    // Validate modelToolName format
    if (body.definition?.modelToolName && !/^[a-zA-Z0-9_-]{1,64}$/.test(body.definition.modelToolName)) {
      return c.json(
        { error: "modelToolName must match pattern ^[a-zA-Z0-9_-]{1,64}$" },
        { status: 400 }
      );
    }

    // Validate that either http or client is set, but not both
    if (body.definition?.http && body.definition?.client) {
      return c.json(
        { error: "Only one implementation (http or client) should be set" },
        { status: 400 }
      );
    }

    if (!body.definition?.http && !body.definition?.client) {
      return c.json(
        { error: "Either http or client implementation must be set" },
        { status: 400 }
      );
    }

    // For client tools, validate only body parameters are used
    if (body.definition?.client) {
      const hasNonBodyParams = [...(body.definition.dynamicParameters || []), 
        ...(body.definition.staticParameters || []), 
        ...(body.definition.automaticParameters || [])]
        .some((param) => param.location !== "PARAMETER_LOCATION_BODY");

      if (hasNonBodyParams) {
        return c.json(
          { error: "Client tools can only use body parameters" },
          { status: 400 }
        );
      }
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    const data = await toolService.createTool(body, userId);
    return c.json(data);
  } catch (error) {
    console.error("Error creating tool:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
});

app.get('/api/tools', async (c) => {
  try {
    const env = getEnv(c.env);
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    const tools = await toolService.getUserTools(userId);
    return c.json({ tools });
  } catch (error) {
    console.error("Error fetching tools:", error);
    return c.json(
      { error: "Failed to fetch tools" },
      { status: 500 }
    );
  }
});

app.get('/api/tools/:toolId', async (c) => {
  try{
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    const tool = await toolService.getTool(toolId, userId);
    return c.json({ tool });

  }catch(error){
    console.error("Error fetching tool:", error);
    return c.json(
      { error: "Failed to fetch tool" },
      { status: 500 }
    );
  }
})

app.delete('/api/tools/:toolId/deactivate', async (c) => {
  try {
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    await toolService.deactivateTool(toolId, userId);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deactivating tool:", error);
    return c.json(
      { error: "Failed to deactivate tool" },
      { status: 500 }
    );
  }
});

app.patch('/api/tools/:toolId', async (c) => {
  try {
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');
    const body = await c.req.json() as Partial<CreateToolRequest>;

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    // Validate tool name if provided
    if (body.name && body.name.length > 40) {
      return c.json(
        { error: "Tool name must not exceed 40 characters" },
        { status: 400 }
      );
    }

    // Validate modelToolName if provided
    if (body.definition?.modelToolName && !/^[a-zA-Z0-9_-]{1,64}$/.test(body.definition.modelToolName)) {
      return c.json(
        { error: "modelToolName must match pattern ^[a-zA-Z0-9_-]{1,64}$" },
        { status: 400 }
      );
    }

    // Validate implementation if provided
    if (body.definition) {
      if (body.definition.http && body.definition.client) {
        return c.json(
          { error: "Only one implementation (http or client) should be set" },
          { status: 400 }
        );
      }

      // For client tools, validate only body parameters are used
      if (body.definition.client) {
        const hasNonBodyParams = [...(body.definition.dynamicParameters || []), 
          ...(body.definition.staticParameters || []), 
          ...(body.definition.automaticParameters || [])]
          .some((param) => param.location !== "PARAMETER_LOCATION_BODY");

        if (hasNonBodyParams) {
          return c.json(
            { error: "Client tools can only use body parameters" },
            { status: 400 }
          );
        }
      }
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    await toolService.updateTool(toolId, userId, body);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error updating tool:", error);
    return c.json(
      { error: "Failed to update tool" },
      { status: 500 }
    );
  }
});

app.delete('/api/tools/:toolId', async (c) => {
  try {
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    await toolService.deleteTool(toolId, userId);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting tool:", error);
    return c.json(
      { error: "Failed to delete tool" },
      { status: 500 }
    );
  }
});

app.post('/api/twilio/transfer-call', async (c) => {
  try {
    const body = await c.req.json();
    const callId = c.req.query('call_id');
    const twilioService = TwilioService.getInstance();
    const result = await twilioService.transferCall(body, callId);
    return c.json({
      status: 'success',
      data: result
    });
  } catch (error) {
    console.error('Transfer Call Error:', error);
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to transfer call',
    }, 500);
  }
});

app.post('/api/twilio/call', async (c) => {
  try {
    const supabase = getSupabaseClient(c.env);
    const body = await c.req.json();
    const {
      bot_id: botId,
      to_number: toNumber,
      from_number: twilioFromNumber,
      user_id: userId,
      placeholders,
      tools
    } = body;

    const twilioService = TwilioService.getInstance();
    const result = await twilioService.makeCall({
      botId,
      toNumber,
      twilioFromNumber,
      userId,
      placeholders,
      tools,
      supabase,
      env: c.env
    });

    return c.json({
      status: 'success',
      data: result
    });

  } catch (error) {
    console.error('Make Call Error:', error);
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to make call',
    }, 500);
  }
});

app.post('/api/twilio/webhook', async (c) => {
  try {
    const body = await c.req.parseBody();
    const {
      CallSid,
      CallStatus,
      From,
      To,
      Duration
    } = body;

    // Update call status in database
    const supabase = getSupabaseClient(c.env);
    await supabase
      .from('call_logs')
      .update({
        status: CallStatus,
        duration: Duration,
        updated_at: new Date().toISOString()
      })
      .eq('call_sid', CallSid);

    return c.json({
      status: 'success',
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    console.error('Webhook Error:', error);
    return c.json({
      status: 'error',
      message: 'Failed to process webhook',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.post('/api/agent', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { name, user_id, voice_id, system_prompt } = body

    if (!name  || !user_id || !voice_id || !system_prompt) {
      console.error("Recevied /agent/createAgent Error : Missing parameters",{
        name : name,
        user_id : user_id,
        voice_id : voice_id,
        system_prompt : system_prompt
      });
      return c.json({
        status: 'error',
        message: 'Missing parameters',
        error: {
          name : name,
          user_id : user_id,
          voice_id : voice_id,
          system_prompt : system_prompt
        }
      }, 500);
    }

    await fetch('https://api.ultravox.ai/api/voices/' + voice_id, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
    })
      .then(res => res.json())  
      .then(data => {
        console.log("Ultravox API response:", data);
      })
      .catch(error => {
        console.error("Ultravox Voice API error:", error);
        return c.json({
          status: 'error',
          message: 'Invalid Voice ID',
        } , 500);
      });
      
    const { data: insertedBot, error } = await supabase
        .from("bots")
        .insert([{
          name,
          phone_number: "",
          voice :voice_id,
          is_deleted: false,
          created_at: new Date(),
          is_appointment_booking_allowed: false,
          user_id: user_id,
          system_prompt: system_prompt,
        }])
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/create Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: insertedBot ,
    })
  }catch(error){
    console.error("Recevied /agent/create Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

app.patch('/api/agent',async (c)=>{
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { id, name, twilio_from_number, voice_id, system_prompt } = body

    const { data: insertedBot, error } = await supabase
        .from("bots")
        .update({
          name,
          phone_number: twilio_from_number,
          voice :voice_id,
          system_prompt: system_prompt,
        })
        .eq('id', id)
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/update Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: insertedBot ,
    })
  }catch(error){
    console.error("Recevied /agent/update Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

app.delete('/api/agent', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    
    const id  = c.req.query('id')

    if (!id) {
      console.error("Recevied /agent/delete Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    const {data: existingBot, error: supabaseError } = await supabase
        .from("bots")
        .select()
        .eq('id', id)
        .single();
        
    if (!existingBot){
      console.error("Recevied /agent/delete Error : Bot not found");
      return c.json({
        status: 'error',
        message: 'Bot with id ' + id + ' not found',
      } , 500);
    }
    if (existingBot?.is_deleted){
      console.error("Recevied /agent/delete Error : Bot already deleted");
      return c.json({
        status: 'error',
        message: 'Bot with id ' + id + ' already deleted',
      } , 500);
    }
    if (supabaseError){
      console.error("Recevied /agent/delete Error", supabaseError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  supabaseError ,
      } , 500);
    }

    if (supabaseError){
      console.error("Recevied /agent/delete Error", supabaseError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  supabaseError ,
      } , 500);
    }

    const { data: deletedBot, error } = await supabase
        .from("bots")
        .update({
          is_deleted: true,
        })
        .eq('id', id)
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/delete Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: deletedBot ,
    })
  }catch(error){
    console.error("Recevied /agent/delete Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
}) 

app.get('/api/agent/:id', async (c) => {
  try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id  = c.req.param('id')
    if (!id) {
      console.error("Recevied /agent/get Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    const { data: insertedBot, error } = await supabase
      .from("bots")
      .select()
      .eq('id', id)
      .single();

    if (insertedBot?.is_deleted) {
      console.error("Recevied /agent/get Error : Bot not found");
      return c.json({
        status: 'error',
        message: 'Bot not found',
      }, 404);
    }
    if (error) {
      console.error("Recevied /agent/get Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
    return c.json({
      status: 'success',
      data: insertedBot,
    })
  } catch (error) {
    console.error("Recevied /agent/get Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

app.get('/api/agents', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    
    const user_id = c.req.query('user_id')
    
    if (!user_id) {
      console.error("Recevied /agent/getAllAgents Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }

    const { data: insertedBot, error } = await supabase
        .from("bots")
        .select()
        .eq('user_id', user_id);


    const filteredBots = insertedBot?.filter((bot) => !bot.is_deleted);

    if (error){
      console.error("Recevied /agent/getAllAgents Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: filteredBots ,
    })
  }catch(error){
    console.error("Recevied /agent/get Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

export default app
