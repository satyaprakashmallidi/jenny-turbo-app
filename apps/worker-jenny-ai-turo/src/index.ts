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
import webhooksRoutes from './routes/webhooks.routes';
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

  // Add realtime data capture tool if enabled and configured
  const isRealtimeCaptureEnabled = bot?.is_realtime_capture_enabled || false;
  const realtimeCaptureFields = bot?.realtime_capture_fields || [];
  
  if (isRealtimeCaptureEnabled && realtimeCaptureFields.length > 0) {
    const dynamicParameters = realtimeCaptureFields.map((field: any) => {
      const parameter = {
        name: field.name,
        location: "PARAMETER_LOCATION_BODY" as const,
        schema: {
          type: field.type === "text" ? "string" : 
                field.type === "number" ? "number" : 
                field.type === "boolean" ? "boolean" : 
                "string",
          description: field.description,
          ...(field.type === "enum" && field.enum_values && field.enum_values.length > 0 
            ? { enum: field.enum_values } 
            : {})
        },
        required: field.required || false
      };
      
      return parameter;
    });

    const captureOutcomeTool = {
      toolName: "captureOutcome",
      temporaryTool: {
        modelToolName: "captureOutcome",
        description: "Capture data in real-time during conversation based on configured fields",
        dynamicParameters: dynamicParameters,
        http: {
          baseUrlPattern: "https://jenny-ai-turo.everyai-com.workers.dev/api/capture-outcome",
          httpMethod: "POST"
        }
      }
    };

    tools.push(captureOutcomeTool);
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
app.route('/api/webhooks', webhooksRoutes);

app.post('/api/finish-call', finishCall);

// Debug endpoint for campaign status
app.get('/api/debug-campaign/:campaign_id', async (c) => {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ status: 'error', message: 'Missing campaign_id' }, 400);
    }
    
    // Get campaign details
    const { data: campaignData, error: campaignError } = await c.req.db
      .from('call_campaigns')
      .select('*')
      .eq('campaign_id', campaign_id)
      .single();
    
    if (campaignError || !campaignData) {
      return c.json({ status: 'error', message: 'Campaign not found', error: campaignError?.message }, 404);
    }
    
    // Get all contacts with their status
    const { data: contactsData, error: contactsError } = await c.req.db
      .from('call_campaign_contacts')
      .select('contact_id, contact_phone, contact_name, call_status, call_duration, ultravox_call_id, completed_at, error_message')
      .eq('campaign_id', campaign_id)
      .order('created_at', { ascending: true });
    
    if (contactsError) {
      return c.json({ status: 'error', message: 'Failed to fetch contacts', error: contactsError.message }, 500);
    }
    
    // Count statuses
    const statusCounts = {
      pending: 0,
      queued: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    };
    
    contactsData?.forEach((contact: any) => {
      const status = contact.call_status;
      if (status in statusCounts) {
        statusCounts[status as keyof typeof statusCounts]++;
      }
    });
    
    // Check if database trigger should have fired
    const totalContacts = contactsData?.length || 0;
    const pendingContacts = statusCounts.pending + statusCounts.queued + statusCounts.in_progress;
    const shouldBeCompleted = pendingContacts === 0 && totalContacts > 0;
    
    return c.json({
      status: 'success',
      campaign: {
        campaign_id: campaignData.campaign_id,
        campaign_name: campaignData.campaign_name,
        status: campaignData.status,
        created_at: campaignData.created_at,
        started_at: campaignData.started_at,
        completed_at: campaignData.completed_at,
        total_contacts: campaignData.total_contacts
      },
      contact_status_counts: statusCounts,
      contacts: contactsData,
      analysis: {
        total_contacts: totalContacts,
        pending_contacts: pendingContacts,
        should_be_completed: shouldBeCompleted,
        database_trigger_issue: shouldBeCompleted && campaignData.status !== 'completed',
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Debug Campaign Error:', error);
    return c.json({ status: 'error', message: 'Internal server error', error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// Manual campaign status update endpoint
app.post('/api/force-update-campaign/:campaign_id', async (c) => {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ status: 'error', message: 'Missing campaign_id' }, 400);
    }
    
    const { CampaignsService } = await import('./services/campaigns.service');
    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(c.req.db, c.req.env);
    
    const result = await campaignsService.checkAndUpdateCampaignStatus(campaign_id);
    
    return c.json({
      status: 'success',
      message: 'Campaign status check forced',
      result: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Force Update Campaign Error:', error);
    return c.json({ status: 'error', message: 'Internal server error', error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// Lock management endpoints for debugging
app.get('/api/check-lock', async (c) => {
  try {
    const number = c.req.query('number');
    if (!number) {
      return c.json({ status: 'error', message: 'Missing number parameter' }, 400);
    }
    
    // Normalize number for locking key
    const normalizedNumber = number.replaceAll("+", "").replaceAll(" ", "").replaceAll("-", "");
    const lockKey = `locked_twilio:${normalizedNumber}`;
    
    const lockValue = await c.req.env.ACTIVE_CALLS.get(lockKey);
    
    return c.json({
      status: 'success',
      number: number,
      normalized_number: normalizedNumber,
      lock_key: lockKey,
      is_locked: !!lockValue,
      lock_value: lockValue,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Check Lock Error:', error);
    return c.json({ status: 'error', message: 'Failed to check lock', error: error instanceof Error ? error.message : error }, 500);
  }
});

app.post('/api/remove-lock', async (c) => {
  try {
    const body = await c.req.json();
    const { number } = body;
    
    if (!number) {
      return c.json({ status: 'error', message: 'Missing number parameter' }, 400);
    }
    
    // Normalize number for locking key
    const normalizedNumber = number.replaceAll("+", "").replaceAll(" ", "").replaceAll("-", "");
    const lockKey = `locked_twilio:${normalizedNumber}`;
    
    // Check if lock exists before removing
    const lockValue = await c.req.env.ACTIVE_CALLS.get(lockKey);
    
    if (lockValue) {
      await c.req.env.ACTIVE_CALLS.delete(lockKey);
      console.log(`🔓 Manually removed lock for number: ${normalizedNumber}`);
    }
    
    return c.json({
      status: 'success',
      message: lockValue ? 'Lock removed successfully' : 'No lock found',
      number: number,
      normalized_number: normalizedNumber,
      was_locked: !!lockValue,
      previous_lock_value: lockValue,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Remove Lock Error:', error);
    return c.json({ status: 'error', message: 'Failed to remove lock', error: error instanceof Error ? error.message : error }, 500);
  }
});

app.get('/api/list-locks', async (c) => {
  try {
    // Get all keys with the lock prefix (this is a limitation - KV doesn't support listing by prefix easily)
    // For now, we'll return a simple response indicating the endpoint exists
    return c.json({
      status: 'success',
      message: 'Use check-lock endpoint with specific number to check individual locks',
      endpoints: {
        check_lock: '/api/check-lock?number=+1234567890',
        remove_lock: '/api/remove-lock (POST with {"number": "+1234567890"})'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('List Locks Error:', error);
    return c.json({ status: 'error', message: 'Failed to list locks', error: error instanceof Error ? error.message : error }, 500);
  }
});

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
});

app.post('/api/capture-outcome', async (c) => {
  try {
    const body = await c.req.json();
    console.log("Capturing Outcome", body);
    
    // Extract call ID from request headers or body
    let callId = c.req.header('X-Call-ID') || body.callId;
    
    if (!callId) {
      console.error("No call ID provided for capture outcome");
      return c.json({
        status: 'error',
        message: 'Call ID is required',
      }, 400);
    }
    
    // Save captured data to call_records
    try {
      // Remove callId from body to avoid duplication
      const { callId: _, ...capturedData } = body;
      
      const { data: existingRecord, error: fetchError } = await c.req.db
        .from('call_records')
        .select('additional_data')
        .eq('call_id', callId)
        .single();
        
      if (fetchError) {
        console.error("Error fetching existing call record:", fetchError);
        return c.json({
          status: 'error',
          message: 'Failed to find call record',
        }, 500);
      }
      
      // Merge existing additional_data with captured data
      const updatedAdditionalData = {
        ...existingRecord.additional_data,
        captured_data: {
          ...(existingRecord.additional_data?.captured_data || {}),
          ...capturedData
        },
        capture_timestamp: new Date().toISOString()
      };
      
      const { error: updateError } = await c.req.db
        .from('call_records')
        .update({ 
          additional_data: updatedAdditionalData,
        })
        .eq('call_id', callId);
        
      if (updateError) {
        console.error("Error updating call record with captured data:", updateError);
        return c.json({
          status: 'error',
          message: 'Failed to save captured data',
        }, 500);
      }
      
      console.log("Successfully saved captured data to call_records for call:", callId);
      console.log("Captured data:", capturedData);
      
    } catch (dbError) {
      console.error("Database error while saving captured data:", dbError);
      return c.json({
        status: 'error', 
        message: 'Database error occurred',
      }, 500);
    }
    
    return c.json({
      status: 'success',
      message: 'Outcome captured and saved successfully',
    });
  } catch (error) {
    console.error("Capturing Outcome Error:", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
});

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

    // if(!body?.firstSpeaker){
    //   body.firstSpeaker = "FIRST_SPEAKER_USER";
    // }

    if(!body?.experimentalSettings){
      body.experimentalSettings = {
        backSeatDriver: true,
        model: "o4-mini",
        enableFunctionInsertion: true,
      }
    }

    body.selectedTools = body.selectedTools || [];
    
    // Add realtime capture tool if bot has it enabled
    if (body.metadata?.botId) {
      const { data: botData, error } = await c.req.db
        .from('bots')
        .select('is_realtime_capture_enabled, realtime_capture_fields')
        .eq('id', body.metadata?.botId)
        .single();

      if (!error && botData?.is_realtime_capture_enabled && botData?.realtime_capture_fields) {
        const realtimeCaptureFields = botData.realtime_capture_fields as any[];
        
        // Generate dynamic parameters for the captureOutcome tool
        const dynamicParameters = realtimeCaptureFields.map(field => ({
          name: field.name,
          location: "PARAMETER_LOCATION_BODY",
          schema: field.type === 'text' 
            ? { type: "string", description: field.description }
            : field.type === 'number'
            ? { type: "number", description: field.description }
            : field.type === 'boolean'
            ? { type: "boolean", description: field.description }
            : field.type === 'enum'
            ? { type: "string", enum: field.enum_values, description: field.description }
            : { type: "string", description: field.description },
          required: field.required
        }));

        const captureOutcomeTool = {
          temporaryTool: {
            modelToolName: "captureOutcome",
            description: "Capture data in real-time during conversation based on configured fields",
            dynamicParameters: dynamicParameters,
            automaticParameters: [
              {
                name: "callId",
                location: "PARAMETER_LOCATION_BODY",
                knownValue: "KNOWN_PARAM_CALL_ID"
              }
            ],
            http: {
              baseUrlPattern: "https://2d0b9fe78cf6.ngrok-free.app/api/capture-outcome",
              httpMethod: "POST"
            }
          }
        };

        // Add the tool to the body
        body.selectedTools.push(captureOutcomeTool);
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
      const lockValue = await c.req.env.ACTIVE_CALLS.get(twilioLockKey);
      
      if (lockValue) {
        await c.req.env.ACTIVE_CALLS.delete(twilioLockKey);
        console.log(`🔓 Manually unlocked Twilio number: ${twilio_number}`);
        
        return c.json({
          status: 'success',
          message: `Successfully unlocked Twilio number: ${twilio_number}`,
          was_locked: true,
          lock_value: lockValue
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

app.get('/api/twilio-lock-status/:number', async (c) => {
  try {
    const twilio_number = c.req.param('number');
    
    if (!twilio_number) {
      return c.json({
        status: 'error',
        message: 'Missing twilio number in URL path'
      }, 400);
    }

    const twilioLockKey = `locked_twilio:${twilio_number}`;
    const lockValue = await c.req.env.ACTIVE_CALLS.get(twilioLockKey);
    
    return c.json({
      status: 'success',
      twilio_number,
      is_locked: !!lockValue,
      lock_key: twilioLockKey,
      lock_value: lockValue,
      locked_at: lockValue ? new Date().toISOString() : null
    });
  } catch (error) {
    console.error('Check Twilio Lock Status Error:', error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.delete('/api/twilio-lock/:number', async (c) => {
  try {
    const twilio_number = c.req.param('number');
    
    if (!twilio_number) {
      return c.json({
        status: 'error',
        message: 'Missing twilio number in URL path'
      }, 400);
    }

    const twilioLockKey = `locked_twilio:${twilio_number}`;
    
    try {
      // Get current lock value before deleting
      const lockValue = await c.req.env.ACTIVE_CALLS.get(twilioLockKey);
      
      // Always try to delete (won't error if key doesn't exist)
      await c.req.env.ACTIVE_CALLS.delete(twilioLockKey);
      
      console.log(`🔓 Deleted lock for Twilio number: ${twilio_number}`);
      
      return c.json({
        status: 'success',
        message: `Lock removed for Twilio number: ${twilio_number}`,
        twilio_number,
        was_locked: !!lockValue,
        previous_lock_value: lockValue
      });
    } catch (error) {
      console.error(`❌ Error removing lock for Twilio number ${twilio_number}:`, error);
      return c.json({
        status: 'error',
        message: 'Failed to remove lock',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  } catch (error) {
    console.error('Delete Twilio Lock Error:', error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.post('/api/requeue-pending-jobs', async (c) => {
  try {
    const body = await c.req.json();
    const { campaign_id } = body;
    
    if (!campaign_id) {
      return c.json({
        status: 'error',
        message: 'Missing campaign_id parameter'
      }, 400);
    }

    // Find pending call jobs for this campaign
    const { data: pendingJobs, error } = await c.req.db
      .from('call_jobs')
      .select('*')
      .eq('campaign_id', campaign_id)
      .eq('status', 'pending');

    if (error) {
      return c.json({
        status: 'error',
        message: 'Failed to fetch pending jobs',
        error: error.message
      }, 500);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return c.json({
        status: 'success',
        message: 'No pending jobs found',
        requeued_count: 0
      });
    }

    console.log(`🔄 Found ${pendingJobs.length} pending jobs to requeue for campaign: ${campaign_id}`);

    let requeuedCount = 0;
    for (const job of pendingJobs) {
      try {
        console.log(`🚀 Requeuing job: ${job.job_id} for contact: ${job.payload.contact_phone}`);
        
        await c.req.env.calls_que.send({
          job_id: job.job_id,
          payload: job.payload
        });
        
        requeuedCount++;
        console.log(`✅ Successfully requeued job: ${job.job_id}`);
      } catch (error) {
        console.error(`❌ Failed to requeue job ${job.job_id}:`, error);
      }
    }

    return c.json({
      status: 'success',
      message: `Successfully requeued ${requeuedCount} pending jobs`,
      total_pending: pendingJobs.length,
      requeued_count: requeuedCount
    });

  } catch (error) {
    console.error('Requeue Pending Jobs Error:', error);
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
      lock_key: twilioLockKey,
      lock_value: isLocked
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

app.post('/api/clear-all-locks', async (c) => {
  try {
    const body = await c.req.json();
    const { twilio_numbers } = body;
    
    if (!twilio_numbers || !Array.isArray(twilio_numbers)) {
      return c.json({
        status: 'error',
        message: 'Missing or invalid twilio_numbers array'
      }, 400);
    }

    const results = [];
    for (const number of twilio_numbers) {
      const twilioLockKey = `locked_twilio:${number}`;
      try {
        const wasLocked = await c.req.env.ACTIVE_CALLS.get(twilioLockKey);
        await c.req.env.ACTIVE_CALLS.delete(twilioLockKey);
        results.push({
          number,
          was_locked: !!wasLocked,
          cleared: true
        });
        console.log(`🧹 Cleared lock for number: ${number}`);
      } catch (error) {
        results.push({
          number,
          was_locked: false,
          cleared: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return c.json({
      status: 'success',
      message: `Processed ${twilio_numbers.length} numbers`,
      results
    });
  } catch (error) {
    console.error('Clear All Locks Error:', error);
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

    console.log("queue batch recevied ", batch.messages);
    
    for (const msg of batch.messages) {
      const { job_id, payload } = msg.body;
      
      console.log(`Processing queue message for job_id: ${job_id}, contact: ${payload.contact_phone || payload.toNumber}`);
      console.log(`Campaign settings:`, payload.campaign_settings);
      console.log(`Twilio numbers available:`, payload.twilio_phone_numbers);
      console.log(`🔒 Number locking enabled:`, payload.campaign_settings?.enableNumberLocking || false);
      console.log(`📞 Campaign ID:`, payload.campaign_id);
      console.log(`👤 Contact ID:`, payload.contact_id);
      
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

        let callId = null;
        
        // Get retry count from database (instead of payload since Cloudflare Queue doesn't support payload modification)
        let retryCount = 0;
        try {
          const { data: jobData } = await supabase
            .from('call_jobs')
            .select('retry_count')
            .eq('job_id', job_id)
            .single();
          retryCount = jobData?.retry_count || 0;
        } catch (error) {
          console.log('Could not retrieve retry count, defaulting to 0');
          retryCount = 0;
        }
        const maxRetries = 100;
        
        if (retryCount >= maxRetries) {
          console.log(`❌ Job ${job_id} exceeded max retries (${maxRetries}), marking as failed`);
          
          // Mark as permanently failed
          await supabase.from('call_jobs').upsert({ 
            job_id, 
            status: 'failed', 
            error_message: `Exceeded maximum retry attempts (${maxRetries})`, 
            updated_at: new Date().toISOString(), 
            processed_at: new Date().toISOString() 
          }, { onConflict: 'job_id' });

          // Update campaign contact status if this is a campaign call
          if (payload.campaign_id && payload.contact_id) {
            await supabase
              .from('call_campaign_contacts')
              .update({
                call_status: 'failed',
                error_message: `Exceeded maximum retry attempts (${maxRetries})`,
                completed_at: new Date().toISOString()
              })
              .eq('contact_id', payload.contact_id);
          }
          
          // Log to dead letter queue table for observability
          try {
            await supabase.from('call_failed_jobs').insert([{
              job_id,
              campaign_id: payload.campaign_id,
              contact_id: payload.contact_id,
              contact_phone: payload.contact_phone || payload.toNumber,
              error_message: `Exceeded maximum retry attempts (${maxRetries})`,
              retry_count: retryCount,
              failed_at: new Date().toISOString(),
              payload: payload
            }]);
          } catch (dlqError) {
            console.error('Failed to log to dead letter queue:', dlqError);
          }
          
          return;
        }
        
        try {
          // Check time window before making the call
          console.log(`🕐 Time window check for job ${job_id}:`, {
            hasTimeWindow: !!payload.campaign_settings?.timeWindow,
            timeWindow: payload.campaign_settings?.timeWindow,
            timezone: payload.campaign_settings?.timezone || 'UTC',
            currentTime: new Date().toISOString()
          });
          
          if (payload.campaign_settings?.timeWindow) {
            const { CampaignsService } = await import('./services/campaigns.service');
            const campaignsService = CampaignsService.getInstance();
            campaignsService.setDependencies(supabase, processedEnv);
            
            // Use the campaign's timezone or default to UTC
            const timezone = payload.campaign_settings?.timezone || 'UTC';
            const isWithinWindow = campaignsService.isWithinTimeWindow(
              payload.campaign_settings.timeWindow, 
              timezone
            );
            
            if (!isWithinWindow) {
              console.log(`⏰ Job ${job_id} is outside time window, requeueing for later`);
              
              // Calculate delay until next allowed time (15 minutes minimum)
              const delayMinutes = 15;
              
              // Reset job status back to pending for retry
              await supabase.from('call_jobs').upsert({ 
                job_id, 
                status: 'pending', 
                error_message: `Outside time window - requeueing for ${delayMinutes} minutes - ${new Date().toISOString()}`,
                updated_at: new Date().toISOString() 
              }, { onConflict: 'job_id' });
              
              // Reset campaign contact status if this is a campaign call
              if (payload.campaign_id && payload.contact_id) {
                await supabase
                  .from('call_campaign_contacts')
                  .update({
                    call_status: 'queued',
                    error_message: `Outside time window - requeueing for ${delayMinutes} minutes - ${new Date().toISOString()}`
                  })
                  .eq('contact_id', payload.contact_id);
              }
              
              msg.retry({
                delaySeconds: delayMinutes * 60 // Convert to seconds
              });
              return;
            }
          }
          
          // Call TwilioService.makeCall (single attempt)
          const twilioService = TwilioService.getInstance();
          twilioService.setDependencies(supabase, processedEnv);
          
          // Ensure metadata is properly set for campaign calls
          payload.callConfig.metadata = {
            ...(payload.callConfig.metadata || {}),
            job_id: job_id,
            campaign_id: payload.campaign_id,
            contact_id: payload.contact_id
          };

          console.log(`🔄 Processing job ${job_id} (attempt ${retryCount + 1}/${maxRetries + 1})`);
          console.log("📋 Full campaign metadata being sent:", {
            job_id: job_id,
            campaign_id: payload.campaign_id,
            contact_id: payload.contact_id,
            metadata_in_callConfig: payload.callConfig.metadata
          });
          console.log("🔒 Number locking enabled:", payload.campaign_settings?.enableNumberLocking || false);
          console.log("📞 Available Twilio numbers:", payload.twilio_phone_numbers?.length || 1);
          console.log("⏰ Time window check:", payload.campaign_settings?.timeWindow ? "Passed" : "Not configured");
          
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
          
        } catch (error) {
          console.log("Queue Processing Error", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // Calculate exponential backoff delay: 15 * 2^retryCount, max 300 seconds
          const baseDelay = 15;
          const exponentialDelay = Math.min(300, baseDelay * Math.pow(2, retryCount));
          
          // If Ultravox returns 429, use exponential backoff
          if (errorMessage.toLowerCase().includes('concurency limit')) {
            console.log(`🔄 Ultravox concurrency limit hit, retrying in ${exponentialDelay}s (attempt ${retryCount + 1})`);
            
            // Reset job status back to pending for retry
            await supabase.from('call_jobs').upsert({ 
              job_id, 
              status: 'pending', 
              error_message: `Waiting for Ultravox capacity - attempt ${retryCount + 1} - ${new Date().toISOString()}`,
              updated_at: new Date().toISOString() 
            }, { onConflict: 'job_id' });
            
            // Reset campaign contact status if this is a campaign call
            if (payload.campaign_id && payload.contact_id) {
              await supabase
                .from('call_campaign_contacts')
                .update({
                  call_status: 'queued',
                  error_message: `Waiting for Ultravox capacity - attempt ${retryCount + 1} - ${new Date().toISOString()}`
                })
                .eq('contact_id', payload.contact_id);
            }
            
            // Store updated retry count in database instead of message payload since 
            // Cloudflare Queue doesn't support payload modification in retry
            await supabase.from('call_jobs').upsert({ 
              job_id, 
              retry_count: retryCount + 1,
              updated_at: new Date().toISOString() 
            }, { onConflict: 'job_id' });
            
            msg.retry({
              delaySeconds: exponentialDelay
            });
            return;
          }
          
          // If Twilio number is busy, use shorter exponential backoff
          if (errorMessage.includes('TWILIO_BUSY:')) {
            // Check if we've exceeded max retries for TWILIO_BUSY errors too
            if (retryCount >= maxRetries) {
              console.log(`❌ Job ${job_id} exceeded max retries (${maxRetries}) for TWILIO_BUSY, marking as failed`);
              
              // Mark as permanently failed
              await supabase.from('call_jobs').upsert({ 
                job_id, 
                status: 'failed', 
                error_message: `All Twilio numbers busy - exceeded max retries (${maxRetries})`, 
                updated_at: new Date().toISOString(), 
                processed_at: new Date().toISOString() 
              }, { onConflict: 'job_id' });

              // Update campaign contact status if this is a campaign call
              if (payload.campaign_id && payload.contact_id) {
                await supabase
                  .from('call_campaign_contacts')
                  .update({
                    call_status: 'failed',
                    error_message: `All Twilio numbers busy - exceeded max retries (${maxRetries})`,
                    completed_at: new Date().toISOString()
                  })
                  .eq('contact_id', payload.contact_id);
              }
              
              // Log to dead letter queue table for observability
              try {
                await supabase.from('call_failed_jobs').insert([{
                  job_id,
                  campaign_id: payload.campaign_id,
                  contact_id: payload.contact_id,
                  contact_phone: payload.contact_phone || payload.toNumber,
                  error_message: `All Twilio numbers busy - exceeded max retries (${maxRetries})`,
                  retry_count: retryCount,
                  failed_at: new Date().toISOString(),
                  payload: payload
                }]);
              } catch (dlqError) {
                console.error('Failed to log to dead letter queue:', dlqError);
              }
              
              return;
            }
            
            // Add minimum delay to prevent race conditions + exponential backoff
            const minDelayForRaceCondition = 3; // Minimum 3 seconds to prevent race conditions
            const twilioBaseDelay = 5; // 5 seconds base delay for Twilio retries
            const exponentialBackoff = twilioBaseDelay * Math.pow(1.3, retryCount); // Gentler exponential growth
            const twilioDelay = Math.min(60, Math.max(minDelayForRaceCondition, exponentialBackoff)); // Max 60 seconds instead of 120
            console.log(`📞 Twilio numbers busy, retrying in ${twilioDelay}s (attempt ${retryCount + 1}/${maxRetries + 1}): ${errorMessage}`);
            console.log(`🔧 Retry calculation: baseDelay=${twilioBaseDelay}, retryCount=${retryCount}, exponentialBackoff=${exponentialBackoff}, finalDelay=${twilioDelay}`);
            console.log(`Job ID: ${job_id}, Contact: ${payload.contact_phone || payload.toNumber}`);
            
            // Reset job status back to pending for retry
            await supabase.from('call_jobs').upsert({ 
              job_id, 
              status: 'pending', 
              error_message: `Waiting for available Twilio number - attempt ${retryCount + 1} - ${new Date().toISOString()}`,
              updated_at: new Date().toISOString() 
            }, { onConflict: 'job_id' });
            
            // Reset campaign contact status if this is a campaign call
            if (payload.campaign_id && payload.contact_id) {
              await supabase
                .from('call_campaign_contacts')
                .update({
                  call_status: 'queued',
                  error_message: `Waiting for available Twilio number - attempt ${retryCount + 1} - ${new Date().toISOString()}`
                })
                .eq('contact_id', payload.contact_id);
            }
            
            // Store updated retry count in database
            await supabase.from('call_jobs').upsert({ 
              job_id, 
              retry_count: retryCount + 1,
              updated_at: new Date().toISOString() 
            }, { onConflict: 'job_id' });
            
            msg.retry({
              delaySeconds: twilioDelay
            });
            continue;
          }
          
          // Other error, mark as failed immediately
          console.log(`❌ Permanent failure for job ${job_id}: ${errorMessage}`);
          
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
          
          // Log to dead letter queue table for observability
          try {
            await supabase.from('call_failed_jobs').insert([{
              job_id,
              campaign_id: payload.campaign_id,
              contact_id: payload.contact_id,
              contact_phone: payload.contact_phone || payload.toNumber,
              error_message: errorMessage,
              retry_count: retryCount,
              failed_at: new Date().toISOString(),
              payload: payload
            }]);
          } catch (dlqError) {
            console.error('Failed to log to dead letter queue:', dlqError);
          }
          
          continue;
        }
        // Success: update job with callId
        console.log(`✅ Call created successfully with Ultravox call ID: ${callId}`);
        const { error: jobUpdateError } = await supabase.from('call_jobs').upsert({ 
          job_id, 
          status: 'success', 
          ultravox_call_id: callId,
          updated_at: new Date().toISOString(), 
          processed_at: new Date().toISOString() 
        }, { onConflict: 'job_id' });
        
        if (jobUpdateError) {
          console.error(`❌ Failed to update job with ultravox_call_id:`, jobUpdateError);
        } else {
          console.log(`✅ Successfully updated job ${job_id} with ultravox_call_id: ${callId}`);
        }

        // Update campaign contact with call ID if this is a campaign call
        if (payload.campaign_id && payload.contact_id && callId) {
          console.log(`📞 Updating campaign contact with ultravox_call_id:`, {
            campaign_id: payload.campaign_id,
            contact_id: payload.contact_id,
            ultravox_call_id: callId
          });
          
          const { error: contactUpdateError } = await supabase
            .from('call_campaign_contacts')
            .update({
              ultravox_call_id: callId,
              call_status: 'in_progress' // Will be updated to completed by webhook
            })
            .eq('contact_id', payload.contact_id);
            
          if (contactUpdateError) {
            console.error(`❌ Failed to update campaign contact with ultravox_call_id:`, contactUpdateError);
          } else {
            console.log(`✅ Successfully updated campaign contact ${payload.contact_id} with call ID`);
          }
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
