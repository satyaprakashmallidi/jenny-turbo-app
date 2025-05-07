import { createApp } from './config/hono'
import twilioRoutes from './routes/twilio.routes'
import agentRoutes from './routes/agents.routes'
import toolRoutes from './routes/tools.routes'
import { CallConfigWebhookResponse } from '@repo/common-types/types';
import { finishCall } from './controller/twilio.controller';
import corpusRoutes from './routes/corpus.routes'
import singleTwilioRoutes from './routes/single-twilio-account.routes'
import callTranscriptsRoutes from './routes/call-transcripts.routes'
import { CallDetails } from './controller/twilio.controller';
import Voice from 'twilio/lib/rest/Voice';
import { TwilioService } from './services/twilio.service';

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

  const sid_data = await sid_response.json();

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
  const { voice , system_prompt , name , temperature , is_appointment_booking_allowed , appointment_tool_id , knowledge_base_id } = bot;

  let tools = [{
    toolName: "hangUp"
  }];

  if(knowledge_base_id){
    tools.push({
      toolName: "queryCorpus",
      parameterOverrides: {
        corpus_id: knowledge_base_id,
        max_results: 5
      }
    });
  }

  const callConfig: CallConfigWebhookResponse = {
    voice,
    temperature: temperature>0 ?`0.${temperature}` : '0',
    joinTimeout: "30s",
    maxDuration: "300s",
    recordingEnabled: true,
    timeExceededMessage: "I'm sorry, I can't help you with that.",
    systemPrompt: system_prompt,
    medium: {
      twilio: {}
    },
    metadata: {
      bot_id: botId,
      user_id: userId
    },
    selectedTools: tools
  };

  const response = await fetch('https://api.ultravox.ai/api/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': c.req.env.ULTRAVOX_API_KEY,
    },
    body: JSON.stringify(callConfig),
  });

  if (!response.ok) {

    console.error("Ultravox API error:", await response.text());
    return c.text(errorResponse, 200 , {
      'Content-Type': 'text/xml'
    });
  }

  const ultravoxResp = await response.json() as CallConfigWebhookResponse;

  console.log("Ultravox Response", ultravoxResp);

  const finalResp = `<Response>
      <Connect>
        <Stream url="${ultravoxResp.joinUrl}"/>
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
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
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

    const data = await response.json();
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

export default app;
