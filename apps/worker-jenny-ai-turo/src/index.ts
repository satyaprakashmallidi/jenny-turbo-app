import { createApp } from './config/hono'
import twilioRoutes from './routes/twilio.routes'
import agentRoutes from './routes/agents.routes'
import toolRoutes from './routes/tools.routes'
import { CallConfigWebhookResponse } from '@repo/common-types/types';
import { finishCall } from './controller/twilio.controller';
import corpusRoutes from './routes/corpus.routes'
import { CallsManager } from './durable_objects/CallsManager';

//Caching Voices
let cachedVoices: any = null;
let lastCacheTime = 0;
const cacheDuration = 60 * 60 * 1000;

const app = createApp();

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

app.post('/api/finish-call', finishCall);

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
