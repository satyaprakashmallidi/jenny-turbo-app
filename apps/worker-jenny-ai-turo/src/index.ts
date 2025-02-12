import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSupabaseClient } from './lib/supabase/client'
import { Env, getEnv } from './config/env'
import { SupabaseClient } from '@supabase/supabase-js'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { twilioData, ultravoxData } from '@repo/common-types/types'


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

  const response = await fetch('https://api.ultravox.ai/api/calls/' + callId, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': c.env.ULTRAVOX_API_KEY,
    },
  });

  const twilioResp = await response.json();

  if(twilioResp && twilioResp?.shortSummary){
  
    await supabase.from('summarys').upsert([
      { call_id: callId , summary: twilioResp?.shortSummary }
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

app.put('/api/twilio/createAccount', async (c) => {
  try{

    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
  
    const body = await c.req.json()
    const { accountSID, authToken, fromNumber, user_id } = body
  
    if (!accountSID || !authToken || !fromNumber || !user_id) {
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }

    const formData = {
      account_sid: accountSID,
      auth_token: authToken,
      from_phone_number: fromNumber,
    }
    const { data, error } = await supabase
      .from('twilio_credentials')
      .insert([{
        ...formData,
        user_id: user_id
      }])
      .select();
    if (error){
      console.error("Recevied /twilio/createAccount Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }

    return c.json({
      status: 'success',
      data: data ,
    })
  }catch(error){
    console.error("Create Account Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }

})

app.patch('/api/twilio/updateAccount', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { accountSID, authToken, fromNumber, user_id, id } = body

    if (!accountSID || !authToken || !fromNumber || !user_id) {
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }

    const { data, error } = await supabase
      .from('twilio_credentials')
      .update({
        account_sid: accountSID,
        auth_token: authToken,
        from_phone_number: fromNumber,
      })
      .eq('id', id)
      .select();

    if (error){
      console.error("Recevied /twilio/updateAccount Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }

    return c.json({
      status: 'success',
      data: data ,
    })

  }catch(error){
    console.error("Update Account Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})


app.delete('/api/twilio/deleteAccount', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { id } = body
    if (!id) {
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    const { data, error } = await supabase
      .from('twilio_credentials')
      .delete()
      .eq('id', id)
      .select();

    if (error){
      console.error("Recevied /twilio/deleteAccount Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: data ,
    })
  }catch(error){
    console.error("Delete Account Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

app.get('/api/twilio/getAccount', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);

    const id = c.req.query('id')
    if (!id) {
      console.error("Recevied /twilio/getAccount Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    const { data, error } = await supabase
      .from('twilio_credentials')
      .select()
      .eq('id', id)
      .single();

    if (error){
      console.error("Recevied /twilio/credentials Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: data ,
    })
  }catch(error){
    console.error("Get Credentials Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

app.get('/api/twilio/getAccounts', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);

    const user_id = c.req.query('user_id')
    if (!user_id) {
      console.error("Recevied /twilio/getAccount Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    
    const { data, error } = await supabase
      .from('twilio_credentials')
      .select()
      .eq('user_id', user_id)
      
    if (error){
      console.error("Recevied /twilio/getAccount Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: data ,
    })
  }catch(error){
    console.error("Get Account Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
})

app.post('/api/agent/createAgent', async (c) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { name, twilio_from_number, user_id, voice_id, system_prompt } = body

    if (!name || !twilio_from_number || !user_id || !voice_id || !system_prompt) {
      console.error("Recevied /agent/createAgent Error : Missing parameters",{
        name : name,
        twilio_from_number : twilio_from_number,
        user_id : user_id,
        voice_id : voice_id,
        system_prompt : system_prompt
      });
      return c.json({
        status: 'error',
        message: 'Missing parameters',
        error: {
          name : name,
          twilio_from_number : twilio_from_number,
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
        console.error("Ultravox API error:", error);
        return c.json({
          status: 'error',
          message: 'Ultravox API error',
        } , 500);
      });
      
    const { data: insertedBot, error } = await supabase
        .from("bots")
        .insert([{
          name,
          phone_number: twilio_from_number,
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

app.post('/api/agent/updateAgent',async (c)=>{
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

app.delete('/api/agent/deleteAgent', async (c) => {
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

    const { data: insertedBot, error } = await supabase
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
      data: insertedBot ,
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

app.get('/api/agent/getAgent', async (c) => {
  try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id  = c.req.query('id')
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

app.get('/api/agent/getAllAgents', async (c) => {
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

// Add this endpoint before export default app
app.post('/api/twilio/make-call', async (c) => {
  try {
    const body = await c.req.json();
    const {
      twilioAccountSid,
      twilioAuthToken,
      twilioFromNumber,
      toNumber,
      botId,
      userName,
      userId,
      appointmentId
    } = body;

    // Validate required parameters
    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber || !toNumber || !botId) {
      return c.json({
        status: 'error',
        message: 'Missing required parameters',
      }, 400);
    }

    // 1. First create Ultravox call
    const ultravoxResponse = await fetch('https://api.ultravox.ai/api/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify({
        botId,
        phoneNumber: toNumber,
        userName,
        appointmentId
      }),
    });

    if (!ultravoxResponse.ok) {
      const errorText = await ultravoxResponse.text();
      throw new Error(`Ultravox API error: ${errorText}`);
    }

    const ultravoxData : ultravoxData = await ultravoxResponse.json();

    const ultravoxCallId = ultravoxData?.callId;

    // 2. Create Twilio call and connect it to Ultravox
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`;
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${twilioAccountSid}:${twilioAuthToken}`)
      },
      body: new URLSearchParams({
        To: toNumber,
        From: twilioFromNumber,
        Url: `https://api.ultravox.ai/api/twilio/connect?callId=${ultravoxCallId}`,
        StatusCallback: `${c.env.BASE_URL}/api/twilio/webhook`,
        StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'].join(' '),
        StatusCallbackMethod: 'POST'
      })
    });

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      throw new Error(`Twilio API error: ${errorText}`);
    }

    const twilioData : twilioData = await twilioResponse.json();

    // 3. Save call details to database
    const supabase = getSupabaseClient(c.env);
    const call_date = new Date().toISOString().split('T')[0];

    // Save to user_calls table
    if (userId) {
      const { data: existingData } = await supabase
        .from('user_calls')
        .select('call_details')
        .eq('user_id', userId)
        .eq('call_date', call_date)
        .single();

      let updatedCallDetails = [];
      if (existingData) {
        updatedCallDetails = existingData.call_details || [];
      }
      updatedCallDetails.push({
        [ultravoxCallId]: botId
      });

      await supabase
        .from('user_calls')
        .upsert([{
          user_id: userId,
          call_date,
          call_details: updatedCallDetails,
        }], { onConflict: 'user_id, call_date' });
    }

    // Save initial call status
    await supabase
      .from('call_logs')
      .insert([{
        call_sid: twilioData.sid,
        ultravox_call_id: ultravoxCallId,
        bot_id: botId,
        user_id: userId,
        status: twilioData.status,
        from_number: twilioFromNumber,
        to_number: toNumber,
        created_at: new Date().toISOString()
      }]);

    return c.json({
      status: 'success',
      data: {
        twilioCallSid: twilioData.sid,
        ultravoxCallId: ultravoxCallId,
        status: twilioData.status
      }
    });

  } catch (error) {
    console.error('Make Call Error:', error);
    return c.json({
      status: 'error',
      message: 'Failed to make call',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Add a webhook handler for Twilio status callbacks
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
