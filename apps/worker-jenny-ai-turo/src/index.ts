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
import agentRoutes from './routes/agents.routes'
import toolRoutes from './routes/tools.routes'
import corpusRoutes from './routes/corpus.routes'

//Caching Voices
let cachedVoices: any = null;
let lastCacheTime = 0;
const cacheDuration = 60 * 60 * 1000;

//creating a Hono JS Appplication with Envs
const app = new Hono<{ Bindings: Env }>();


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
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'x-user-id',
    'x-client-id'
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
  maxAge: 600,
  credentials: true
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
app.route('/api/agent', agentRoutes);
app.route('/api/tools', toolRoutes);
app.route('/api/knowledgebase', corpusRoutes);

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

export default app
