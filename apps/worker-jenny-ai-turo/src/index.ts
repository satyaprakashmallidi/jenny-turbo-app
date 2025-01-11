import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSupabaseClient } from './lib/supabase/client'
import { Env, getEnv } from './config/env'
import { SupabaseClient } from '@supabase/supabase-js'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { CallConfig } from '@repo/common-types/types'


//Caching Voices
let cachedVoices: any = null;
let lastCacheTime = 0;
const cacheDuration = 60 * 60 * 1000;

//creating a Hono JS Appplication with Envs
const app = new Hono<{ Bindings: Env }>();


//Extend HonoRequest to Include SupaabaseClient
declare module 'hono' {
  interface HonoRequest {
    db: SupabaseClient,
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

    console.log("Creating Ultravox vefor vavll " , c.env.ULTRAVOX_API_KEY);
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

  const { user_id , call_id , bot_id } = body;
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
    updatedCallDetails.push({
      [call_id]: bot_id
    });  // Append new call to array

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

      const { data , error } = await supabase.from('user_calls').select('call_details').eq('user_id' , userId);
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

export default app
