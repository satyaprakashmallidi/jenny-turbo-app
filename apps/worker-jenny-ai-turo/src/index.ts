import { createApp } from './config/hono'
import twilioRoutes from './routes/twilio.routes'
import agentRoutes from './routes/agents.routes'
import toolRoutes from './routes/tools.routes'
import { CallConfig, CallConfigWebhookResponse } from './types/repo-common-types';
import { finishCall } from './controller/twilio.controller';
import corpusRoutes from './routes/corpus.routes'
import singleTwilioRoutes from './routes/single-twilio-account.routes'
import callTranscriptsRoutes from './routes/call-transcripts.routes'
import { CallDetails } from './controller/twilio.controller';
import Voice from 'twilio/lib/rest/Voice';
import { TwilioService } from './services/twilio.service';
import { CallTranscriptsService } from './services/call-transcripts.service';
import queuedCallsRoutes from './routes/queued-calls.routes';
import campaignsRoutes from './routes/campaigns.routes';
//@ts-ignore
import { env } from 'hono';

// Types for Cloudflare Workers
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

//Caching Voices
let cachedVoices: any = null;
let lastCacheTime = 0;
const cacheDuration = 60 * 60 * 1000;

const app = createApp();

app.post('/api/set-twilio-webhook', async (c) => {
  const body = await c.req.json();
  const { voice_url , account_sid , auth_token , phone_number_sid: phone_number } = body;

  console.log("Set Twilio Webhook Body", body);

  if (!account_sid || !voice_url || !auth_token || !phone_number) {
    return c.json({
      status: 'error',
      message: 'Missing parameters',
    }, 400);
  }

  //get the phone number sid
  const sid_response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${phone_number}`
, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${account_sid}:${auth_token}`).toString('base64')}`,
    },
  });

  const sid_data = await sid_response.json() as { incoming_phone_numbers: { sid: string }[] };

  const phone_number_sid = sid_data?.incoming_phone_numbers?.[0]?.sid;

  console.log("Phone Number SID", phone_number_sid);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers/${phone_number_sid}.json`
, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${account_sid}:${auth_token}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      VoiceUrl: voice_url,
      VoiceMethod: 'GET',
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Twilio API error:", errorText);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: errorText,
    }, 500);
  }

  return c.json({
    status: 'success',
    data: await response.json()
  });
})

app.get('/api/inbound', async (c) => {
  const userId = c.req.query('user_id');
  const botId = c.req.query('bot_id');
  const callSid = c.req.query('CallSid');
  const accountSid = c.req.query('AccountSid');

  const errorResponse = ` <Response>
      <Say voice="alice">Sorry we are currently under maintenance , please call again later</Say>
    </Response>`

  const unauthorizedResponse = ` <Response>
      <Say voice="alice">Kindly Contact Support , The Service is currently Blocked</Say>
    </Response>`
  
  if (!userId || !botId) {
    return c.text(unauthorizedResponse, 200 , {
      'Content-Type': 'text/xml'
    });
  }

  console.log("Inbound API Request", userId, botId);

  const { data, error } = await c.req.db
    .from('bots')
    .select('*')
    .eq('id', botId);

  if (error) {
    return c.text(errorResponse, 200 , {
      'Content-Type': 'text/xml'
    });
  }

  if (!data || data.length === 0) {
    return c.text(errorResponse, 200 , {
      'Content-Type': 'text/xml'
    });
  }

  if(data[0].user_id !== userId) {
    return c.text(unauthorizedResponse, 200 , {
      'Content-Type': 'text/xml'
    });
  }



  const bot = data[0];

  console.log("Bot Data", bot);
  const { voice , system_prompt , name , temperature , is_appointment_booking_allowed ,twilio_phone_number , appointment_tool_id , knowledge_base_id , is_call_transfer_allowed , call_transfer_number } = bot;

  let tools = [{
    toolName: "hangUp"
  }, {
    toolName: "leaveVoicemail",
  }];

  if(knowledge_base_id){
    tools.push({
      toolName: "queryCorpus",
      //@ts-ignore
      parameterOverrides: {
        corpus_id: knowledge_base_id,
        max_results: 5
      }
    });
  }

  const callConfig: CallConfig = {
    voice,
    temperature: temperature>0 ? Number(`0.${temperature}`) : 0,
    joinTimeout: "30s",
    maxDuration: "300s",
    recordingEnabled: true,
    timeExceededMessage: "I'm sorry, I can't help you with that.",
    systemPrompt: system_prompt,
    medium: {
      twilio: {}
    },
    //@ts-ignore
    metadata: {
      bot_id: botId,
      user_id: userId
    },
    selectedTools: tools
  };

  const twilioService = TwilioService.getInstance();

  twilioService.setDependencies(c.req.db, c.req.env);

  const result = await twilioService.makeInboundCall({
    callConfig,
    botId,
    userId,
    tools,
    supabase: c.req.db,
    env: c.req.env,
    temperature: temperature>0 ? Number(`0.${temperature}`) : 0,
    callSid: callSid as string,
    twilioFromNumber: twilio_phone_number,
    transferTo: is_call_transfer_allowed ? call_transfer_number : undefined,
  })

  // const response = await fetch('https://api.ultravox.ai/api/calls', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
  //   },
  //   body: JSON.stringify(callConfig),
  // });

  // if (!response.ok) {

  //   console.error("Ultravox API error:", await response.text());
  //   return c.text(errorResponse, 200 , {
  //     'Content-Type': 'text/xml'
  //   });
  // }

  // const ultravoxResp = await response.json() as CallConfigWebhookResponse;

  // console.log("Ultravox Response", ultravoxResp);

  console.log("Inbound API Response", result);

  const finalResp = `<Response>
      <Connect>
        <Stream url="${result.joinUrl}"/>
      </Connect>
    </Response>`;

  return c.text(finalResp, 200 , {
    'Content-Type': 'text/xml'
  });
  
})

app.post('/api/async-amd-status', async (c) => {
    const body = await c.req.parseBody();
    const AccountSid = body.AccountSid;
    const answeredBy = body.AnsweredBy;
    const CallSid = body.CallSid;

    console.log("Async AMD Status" , AccountSid , answeredBy , CallSid );

    if(answeredBy === 'machine_start' || answeredBy === 'machine_end_beep' || answeredBy === 'machine_end_silence' || answeredBy === 'machine_end_other'){
      await TwilioService.getInstance().voiceMailDetector(CallSid as string, AccountSid as string);
    }
    
    return c.json({
      status: 'success',
      message: 'Async AMD Status received',
    });
})

app.post('/api/test', async (c) => {

  const accountSid = c.req.query('account_sid');

  if (!accountSid) {
    return c.json({
      status: 'error',
      message: 'Missing parameters',
    }, 400);
  }

  const { data, error } = await c.req.db
            .from('twilio_account')
            .select('user_id , account_name')
            .eq('account_sid', accountSid);

            console.log("Test API Response", data, error);

            return c.json({
              status: 'success',
              data,
              error
            });
});


export interface CallMessage {
  role: string;
  text: string;
  medium: string;
  callStageId: string;
  callStageMessageIndex: number;
}

export interface CallTranscriptResponse {
  status: string;
  data: {
    next: string | null;
    previous: string | null;
    total: number;
    results: CallMessage[];
  };
}

interface CallTranscriptMap {
  [callId: string]: {
      messages: CallMessage[];
      lastFetched: number;
      hasMore: boolean;
      nextCursor: string | null;
  };
}

app.get('/api/transcript', async (c) => {
  const callId = c.req.query('call_id');
  const cursor = (c.req.query('cursor') || '0');
  const limit = (c.req.query('limit') || '10');

  if (!callId) {
    return c.json({
      status: 'error',
      message: 'Missing callId',
    }, 400);
  }

  const transcriptMap: CallTranscriptMap = {};

  try{
    
    console.log(`Fetching transcript for call: ${callId} ${cursor ? `with cursor: ${cursor}` : ''}`);

    // First, try to get transcripts from the database
    let query = c.req.db
        .from('call_transcripts')
        .select('*')
        .eq('call_id', callId)
        .order('chunk_index', { ascending: true });

    // Apply pagination if cursor is provided
    if (cursor) {
        const parsedCursor = parseInt(cursor, 10);
        if (!isNaN(parsedCursor)) {
            query = query.gt('chunk_index', parsedCursor).limit(20);
        }
    } else {
        query = query.limit(20);
    }

    const { data, error } = await query;

    // If we have data from the database, process and return it
    if (data && data.length > 0 && !error) {
        // Process and format the transcript chunks into CallMessages
        const messages: CallMessage[] = [];
        
        // Since transcript_chunk is stored as a JSON string containing an array of messages
        data.forEach(chunk => {
            try {
                const chunkMessages = JSON.parse(chunk.transcript_chunk);
                if (Array.isArray(chunkMessages)) {
                    messages.push(...chunkMessages);
                }
            } catch (e) {
                console.error('Error parsing transcript chunk:', e);
            }
        });

        // Determine if there's more data to fetch
        const lastIndex = data[data.length - 1].chunk_index;
        const nextCursor = lastIndex !== undefined ? String(lastIndex) : null;

        // Check if there are more records
        const { count } = await c.req.db
            .from('call_transcripts')
            .select('*', { count: 'exact', head: true })
            .eq('call_id', callId)
            .gt('chunk_index', lastIndex);

        const hasMore = !!count && count > 0;

        // Update store based on whether this is initial load or pagination
        transcriptMap[callId] = {
            messages,
            lastFetched: lastIndex,
            hasMore,
            nextCursor: hasMore ? nextCursor : null
            };
  

        console.log(`Retrieved transcript from database for call: ${callId}`);
        return c.json({
            messages,
            hasMore,
            nextCursor: hasMore ? nextCursor : null
        });
    }

    // If no data in database or there was an error, call the API
    console.log(`No transcript found in database for call: ${callId}, calling API...`);
    
    
    // Call the API to get the transcript
    const callTranscriptsService = CallTranscriptsService.getInstance(c.req.env, c.req.db);
    
      const response = await callTranscriptsService.getCallTranscript(callId, 100);
    
   
    const transcriptData = response;
    
    return c.json({
        messages: transcriptData.results,
        hasMore: transcriptData.next,
        nextCursor: transcriptData.next
    });
      
      
  }
  catch(error){
    console.error("Get Call transcripts Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

app.route('/api/queued-calls', queuedCallsRoutes);
app.route('/api/campaigns', campaignsRoutes);
app.route('/api/twilio', twilioRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/tools', toolRoutes);
app.route('/api/knowledgebase', corpusRoutes);
app.route('/api/single-twilio', singleTwilioRoutes);
app.route('/api/call-transcripts', callTranscriptsRoutes);

app.post('/api/finish-call', finishCall);

app.get('/api/get-call-details' , async (c) => {
  try {
    const callId = c.req.query('call_id');
    
    if (!callId) {
      return c.json({
        status: 'error',
        message: 'Missing callId',
      }, 400);
    }

    const { data, error } = await c.req.db
      .from('call_details')
      .select('*')
      .eq('call_id', callId);

    if (error) {
      console.error("Get Call Details Error:", error);
    }

    if ((!data || data.length === 0)  || (data[0].endReason !== 'unjoined' && (!data[0].short_summary  || !data[0].long_summary))) {
      try {
        const response = await fetch(`https://api.ultravox.ai/api/calls/${callId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
          },
        });

        if (!response.ok) {
          return c.json({
            status: 'error',
            message: 'Call not found in Main DB',
          }, 200);
        }

        const ultravoxResp = await response.json() as CallConfigWebhookResponse;
        
        const convert_to_details : CallDetails =  {
          call_id: callId,
          created: ultravoxResp.created,
          joined: ultravoxResp.joined,
          ended: ultravoxResp.ended,
          end_reason: ultravoxResp.endReason,
          recording_enabled: ultravoxResp.recordingEnabled || false,
          join_timeout: ultravoxResp.joinTimeout,
          max_duration: ultravoxResp.maxDuration,
          voice: ultravoxResp.voice,
          temperature: ultravoxResp.temperature,
          time_exceeded_message: ultravoxResp.timeExceededMessage,
          short_summary: ultravoxResp.shortSummary,
          long_summary: ultravoxResp.summary
        }

        const { error } = await c.req.db
          .from('call_details')
          .upsert([convert_to_details], {
            onConflict: 'call_id'
          });

        if (error) {
          console.error("Error while updating call details to our db", error);
        }

        return c.json({
          status: 'success',
          data: convert_to_details
        });

      } catch (error) {
        console.error("Get Call Details From Main DB Error:", error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error: error,
        }, 500);
      }
    }

    return c.json({
      status: 'success',
      data: data[0]
    });

  } catch (error) {
    console.error("Get Call Details Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

app.get('/api/mind-dost', async (c) => {
  try {
    if (!c.req.env.ULTRAVOX_API_KEY) {
      return c.json({
        status: 'error',
        message: 'Ultravox API key missing',
      }, 500);
    }

    const response = await fetch('https://api.ultravox.ai/api/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify({
        voice: "d17917ec-fd98-4c50-8c83-052c575cbf3e",
        temperature: 0.6,
        joinTimeout: "30s",
        maxDuration: "180s",
        recordingEnabled: true,
        timeExceededMessage: "I'm sorry, I can't help you with that.",
        systemPrompt: "You are Mind Dost — pronounce it clearly as 'Mind Dhost' so it sounds like the Hindi word दोस्त. Always refer to yourself as 'Mind Dost' in writing, but speak it as 'Mind Dhost' (for English) or 'माइंड दोस्त' (for Hindi). You are a friendly, intelligent voice assistant who communicates like a human. Be conversational, helpful, emotionally aware, and engaging. Respond in a warm, spoken tone — short and natural, like you're talking to a close friend. At the beginning of the session, always ask the user: 'Would you like to talk in English or Hindi today?' — and remember their choice for the rest of the conversation.",
        metadata: {
          "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712"
        },
        selectedTools: [{"toolName":"hangUp"}]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("MindDost API error:", errorText);
      return c.json({
        status: 'error',
        message: 'MindDost API error',
        error: errorText,
      }, 500);
    }

    const data = await response.json() as CallConfigWebhookResponse;
    return c.json({
      status: 'success',
      join_url: data?.joinUrl
    });
  } catch (error) {
    console.error("Creating Ultravox-mindDost Call Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
})

app.post('/api/ultravox/createcall', async (c) => {
  try {
    const body = await c.req.json();
    console.log("Creating Ultravox Call Body", body);

    if (!c.req.env.ULTRAVOX_API_KEY) {
      return c.json({
        status: 'error',
        message: 'UltraAgent API key missing',
      }, 500);
    }

    if(!body?.firstSpeaker){
      body.firstSpeaker = "FIRST_SPEAKER_USER";
    }

    if(!body?.experimentalSettings){
      body.experimentalSettings = {
        backSeatDriver: true,
        model: "o4-mini",
        enableFunctionInsertion: true,
      }
    }

    const response = await fetch('https://api.ultravox.ai/api/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultravox API error:", errorText);
      return c.json({
        status: 'error',
        message: 'Ultravox API error',
        error: errorText,
      }, 500);
    }

    const data = await response.json();
    return c.json({
      status: 'success',
      data: data
    });
  } catch (error) {
    console.error("Creating Ultravox Call Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

app.get('/api/voices', async (c) => {
  try {
    const now = Date.now();
    if (cachedVoices && now - lastCacheTime < cacheDuration) {
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
        'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultravox API error:", errorText);
      return c.json({
        status: 'error',
        message: 'Ultravox API error',
      }, 500);
    }

    const data = await response.json();
    //@ts-ignore
    const voices = data?.results?.map((voice: any) => ({
      voiceId: voice.voiceId,
      name: voice.name,
      previewUrl: voice.previewUrl,
    }));

    cachedVoices = voices;
    lastCacheTime = now;

    return c.json({
      status: 'success',
      data: voices
    });
  } catch (error) {
    console.error("Fetching Voices Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

app.post('/api/sendSummary', async (c) => {
  try {
    const body = await c.req.json();
    const callId = c.req.query('call_id');
    
    if (!callId) {
      return c.json({
        status: 'error',
        message: 'Missing callId',
      }, 400);
    }

    const { error } = await c.req.db
      .from('summarys')
      .upsert([{ 
        call_id: callId, 
        summary: body?.conversationSummary 
      }], {
        onConflict: 'call_id'
      });

    if (error) {
      console.error("Summary Error:", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }

    return c.json({
      status: 'success',
      message: 'Summary saved successfully',
    });
  } catch (error) {
    console.error("Summary Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

app.post('/api/unlock-twilio-number', async (c) => {
  try {
    const body = await c.req.json();
    const { twilio_number } = body;
    
    if (!twilio_number) {
      return c.json({
        status: 'error',
        message: 'Missing twilio_number parameter'
      }, 400);
    }

    const twilioLockKey = `locked_twilio:${twilio_number}`;
    
    try {
      // Check if the number is currently locked
      const isLocked = await c.req.env.ACTIVE_CALLS.get(twilioLockKey);
      
      if (isLocked) {
        await c.req.env.ACTIVE_CALLS.delete(twilioLockKey);
        console.log(`🔓 Manually unlocked Twilio number: ${twilio_number}`);
        
        return c.json({
          status: 'success',
          message: `Successfully unlocked Twilio number: ${twilio_number}`,
          was_locked: true
        });
      } else {
        console.log(`ℹ️  Twilio number was not locked: ${twilio_number}`);
        
        return c.json({
          status: 'success',
          message: `Twilio number was not locked: ${twilio_number}`,
          was_locked: false
        });
      }
    } catch (error) {
      console.error(`❌ Error unlocking Twilio number:`, error);
      return c.json({
        status: 'error',
        message: 'Failed to unlock Twilio number',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  } catch (error) {
    console.error('Unlock Twilio Number Error:', error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.get('/api/check-twilio-lock', async (c) => {
  try {
    const twilio_number = c.req.query('twilio_number');
    
    if (!twilio_number) {
      return c.json({
        status: 'error',
        message: 'Missing twilio_number parameter'
      }, 400);
    }

    const twilioLockKey = `locked_twilio:${twilio_number}`;
    const isLocked = await c.req.env.ACTIVE_CALLS.get(twilioLockKey);
    
    return c.json({
      status: 'success',
      twilio_number,
      is_locked: !!isLocked,
      lock_key: twilioLockKey
    });
  } catch (error) {
    console.error('Check Twilio Lock Error:', error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.get('/api/getSummary', async (c) => {
  try {
    const callId = c.req.query('call_id');
    
    if (!callId) {
      return c.json({
        status: 'error',
        message: 'Missing callId',
      }, 400);
    }

    const response = await fetch(`https://api.ultravox.ai/api/calls/${callId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
      },
    });

    if (response.ok) {
      const twilioResp = await response.json() as CallConfigWebhookResponse;
      if (twilioResp?.shortSummary) {
        await c.req.db
          .from('summarys')
          .upsert([{
            call_id: callId,
            summary: twilioResp.shortSummary
          }], {
            onConflict: 'call_id'
          });
      }
    }

    const { data, error } = await c.req.db
      .from('summarys')
      .select('*')
      .eq('call_id', callId);

    if (error) {
      console.error("Summary Error:", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }

    return c.json({
      status: 'success',
      data: data
    });
  } catch (error) {
    console.error("Summary Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

app.post('/api/add-call-to-db', async (c) => {
  try {
    const body = await c.req.json();
    const { user_id, call_id, bot_id, placeholders } = body;
    const call_date = new Date().toISOString().split('T')[0];

    const { data: existingData } = await c.req.db
      .from('user_calls')
      .select('call_details')
      .eq('user_id', user_id)
      .eq('call_date', call_date)
      .single();

    let updatedCallDetails = existingData?.call_details || [];
    updatedCallDetails.push(
      placeholders
        ? { [call_id]: { bot_id, placeholders } }
        : { [call_id]: bot_id }
    );

    const { error } = await c.req.db
      .from('user_calls')
      .upsert([{
        user_id,
        call_date,
        call_details: updatedCallDetails,
      }], { 
        onConflict: 'user_id, call_date' 
      });

    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ 
      status: 'success',
      message: 'Call recorded successfully'
    });
  } catch (error) {
    console.error("Add Call Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

app.get('/api/get-all-calls-of-user', async (c) => {
  try {
    const userId = c.req.query('user_id');
    
    if (!userId) {
      return c.json({
        status: 'error',
        message: 'Missing user_id',
      }, 400);
    }

    const { data, error } = await c.req.db
      .from('user_calls')
      .select('call_date, call_details')
      .eq('user_id', userId);

    if (error) {
      console.error("Get Calls Error:", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }

    return c.json({
      status: 'success',
      data: data
    });
  } catch (error) {
    console.error("Get Calls Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});


export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: any, ctx: ExecutionContext): Promise<void> {
    // Import dependencies
    const { getSupabaseClient } = await import('./lib/supabase/client');
    const { getEnv } = await import('./config/env');
    const { CampaignsService } = await import('./services/campaigns.service');
    
    try {
      console.log('Scheduled task running at:', new Date().toISOString());
      
      // Initialize Supabase client
      const processedEnv = getEnv(env);
      const supabase = getSupabaseClient(processedEnv);
      
      // Initialize campaigns service
      const campaignsService = CampaignsService.getInstance();
      campaignsService.setDependencies(supabase, processedEnv);
      
      // Process scheduled campaigns
      const result = await campaignsService.processScheduledCampaigns();
      
      console.log('Scheduled campaigns processed:', result);
      
      if (result.errors.length > 0) {
        console.error('Errors processing scheduled campaigns:', result.errors);
      }
      
    } catch (error) {
      console.error('Error in scheduled task:', error);
    }
  },
  queue: async (batch: MessageBatch<any> , env : env ) => {
    // Import here to avoid circular dependencies
    const { getSupabaseClient } = await import('./lib/supabase/client');
    const { getEnv } = await import('./config/env');
    
    for (const msg of batch.messages) {
      const { job_id, payload } = msg.body;
      
      console.log(`Processing queue message for job_id: ${job_id}, contact: ${payload.contact_phone || payload.toNumber}`);
      console.log(`Campaign settings:`, payload.campaign_settings);
      console.log(`Twilio numbers available:`, payload.twilio_phone_numbers);
      
      // Properly initialize Supabase client for queue context
      const processedEnv = getEnv(env);
      const supabase = getSupabaseClient(processedEnv);
      try {
        // Insert or update job status to 'processing'
        await supabase.from('call_jobs').upsert({ job_id, status: 'processing', updated_at: new Date().toISOString() }, { onConflict: 'job_id' });
        
        // Update campaign contact status if this is a campaign call
        if (payload.campaign_id && payload.contact_id) {
          await supabase
            .from('call_campaign_contacts')
            .update({
              call_status: 'in_progress',
              started_at: new Date().toISOString()
            })
            .eq('contact_id', payload.contact_id);
        }

        let ultravoxData = null;
        let callId = null;
        while (true) {
          try {
            // Call TwilioService.makeCall
            const twilioService = TwilioService.getInstance();
            twilioService.setDependencies(supabase, processedEnv);
            
            payload.callConfig.metadata = {
              ...payload.callConfig.metadata,
              job_id: job_id
            };

            console.log("i am anrasimha ", payload.campaign_settings?.enableNumberLocking);
                       // console.log("Queue Processing Payload", payload);
            const result = await twilioService.makeCall({ 
              ...payload, 
              supabase, 
              env, 
              configureBots: true,
              enableNumberLocking: payload.campaign_settings?.enableNumberLocking || false,
              twilioFromNumbers: payload.twilio_phone_numbers // Pass array of numbers for round-robin
            });
            // Extract callId from result (if present)
            callId = result?.callId || null;
            ultravoxData = result;
            break; // Success, exit retry loop
          } catch (error) {
            console.log("Queue Processing Error", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // If Ultravox returns 429, retry after 60s
            if (errorMessage.toLowerCase().includes('concurency limit')) {
              // Reset job status back to pending for retry
              await supabase.from('call_jobs').upsert({ 
                job_id, 
                status: 'pending', 
                error_message: `Waiting for Ultravox capacity - ${new Date().toISOString()}`,
                updated_at: new Date().toISOString() 
              }, { onConflict: 'job_id' });
              
              // Reset campaign contact status if this is a campaign call
              if (payload.campaign_id && payload.contact_id) {
                await supabase
                  .from('call_campaign_contacts')
                  .update({
                    call_status: 'queued',
                    error_message: `Waiting for Ultravox capacity - ${new Date().toISOString()}`
                  })
                  .eq('contact_id', payload.contact_id);
              }
              
              msg.retry({
                delaySeconds: 60
              });
              return; // Exit current processing attempt, message will be retried later
            }
            
            // If Twilio number is busy, retry after 15s for faster processing
            if (errorMessage.includes('TWILIO_BUSY:')) {
              console.log(`Twilio number busy, retrying in 15 seconds: ${errorMessage}`);
              console.log(`Job ID: ${job_id}, Contact: ${payload.contact_phone || payload.toNumber}`);
              
              // Reset job status back to pending for retry
              await supabase.from('call_jobs').upsert({ 
                job_id, 
                status: 'pending', 
                error_message: `Waiting for available Twilio number - ${new Date().toISOString()}`,
                updated_at: new Date().toISOString() 
              }, { onConflict: 'job_id' });
              
              // Reset campaign contact status if this is a campaign call
              if (payload.campaign_id && payload.contact_id) {
                await supabase
                  .from('call_campaign_contacts')
                  .update({
                    call_status: 'queued',
                    error_message: `Waiting for available Twilio number - ${new Date().toISOString()}`
                  })
                  .eq('contact_id', payload.contact_id);
              }
              
              msg.retry({
                delaySeconds: 15
              });
              return; // Exit current processing attempt, message will be retried later
            }
            
            
            // Other error, mark as failed
            await supabase.from('call_jobs').upsert({ 
              job_id, 
              status: 'failed', 
              error_message: errorMessage, 
              updated_at: new Date().toISOString(), 
              processed_at: new Date().toISOString() 
            }, { onConflict: 'job_id' });

            // Update campaign contact status if this is a campaign call
            if (payload.campaign_id && payload.contact_id) {
              await supabase
                .from('call_campaign_contacts')
                .update({
                  call_status: 'failed',
                  error_message: errorMessage,
                  completed_at: new Date().toISOString()
                })
                .eq('contact_id', payload.contact_id);
            }
            return;
          }
        }
        // Success: update job with callId
        await supabase.from('call_jobs').upsert({ 
          job_id, 
          status: 'success', 
          ultravox_call_id: callId,
          updated_at: new Date().toISOString(), 
          processed_at: new Date().toISOString() 
        }, { onConflict: 'job_id' });

        // Update campaign contact with call ID if this is a campaign call
        if (payload.campaign_id && payload.contact_id && callId) {
          await supabase
            .from('call_campaign_contacts')
            .update({
              ultravox_call_id: callId,
              call_status: 'in_progress' // Will be updated to completed by webhook
            })
            .eq('contact_id', payload.contact_id);
        }

      } catch (error) {
        await supabase.from('call_jobs').upsert({ 
          job_id, 
          status: 'failed', 
          error_message: error instanceof Error ? error.message : String(error), 
          updated_at: new Date().toISOString(), 
          processed_at: new Date().toISOString() 
        }, { onConflict: 'job_id' });

        // Update campaign contact status if this is a campaign call
        if (payload.campaign_id && payload.contact_id) {
          await supabase
            .from('call_campaign_contacts')
            .update({
              call_status: 'failed',
              error_message: error instanceof Error ? error.message : String(error),
              completed_at: new Date().toISOString()
            })
            .eq('contact_id', payload.contact_id);
        }
      }
    }
  }
}
