import { Context } from "hono";
import { TwilioService } from "../services/twilio.service";


type CallRecord = {
  call_id: string;
  user_id: string;
  bot_id: string;
  created_at: string; // ISO timestamp
  additional_data: Record<string, any>; // JSONB field
};

export type CallDetails = {
  call_id: string;
  created?: string; // ISO timestamp
  joined?: string; // ISO timestamp
  ended?: string; // ISO timestamp
  end_reason?: string;
  short_summary?: string;
  long_summary?: string;
  recording_enabled?: boolean;
  join_timeout?: string;
  max_duration?: string;
  voice?: string;
  temperature?: string;
  time_exceeded_message?: string;
  system_prompt?: string;
  metadata?: Record<string, string>;
};


export async function makeCall(c: Context) {
  try {
    const body = await c.req.json();
    const {
      callConfig: callConfig,
      bot_id: botId,
      to_number: toNumber,
      from_number: twilioFromNumber,
      user_id: userId,
      placeholders,
      tools,
      transfer_to: transferTo,
      is_single_twilio_account: isSingleTwilioAccount
    } = body;

    const twilioService = TwilioService.getInstance();
    twilioService.setDependencies(c.req.db, c.req.env);


    console.log("Transfering call to: ", transferTo);
    
    const result = await twilioService.makeCall({
      callConfig,
      botId,
      toNumber,
      twilioFromNumber,
      userId,
      placeholders,
      tools,
      supabase: c.req.db,
      env: c.req.env,
      transferTo,
      isSingleTwilioAccount
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
}

export async function transferCall(c: Context) {
  try {
    const body = await c.req.json();
    const callId = c.req.query('call_id');
    const twilioService = TwilioService.getInstance();
    twilioService.setDependencies(c.req.db, c.req.env);
    const result = await twilioService.transferCall(body, callId || "");
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
}

export async function handleWebhook(c: Context) {
  try {
    const body = await c.req.parseBody();
    const {
      CallSid,
      CallStatus,
      Duration
    } = body;

    await c.req.db
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
}

export async function finishCall(c: Context) {
  try {
    const body = await c.req.json();

    const { event , call } = body;

    console.log( "Event", event , "Call", call);
    
    if(event && call){

      console.log("inside event call");
      // we only subscribed to event = call.ended let's see
      const callDetails : CallDetails = {
        call_id: call.callId,
        created: call.created,
        joined: call.joined,
        ended: call.ended,
        end_reason: call.endReason,
        recording_enabled: call.recordingEnabled,
        join_timeout: call.joinTimeout,
        max_duration: call.maxDuration,
        voice: call.voice,
        temperature: call.temperature,
        time_exceeded_message: call.timeExceededMessage,
        short_summary: call.shortSummary,
        long_summary: call.summary,
        system_prompt: call.systemPrompt,
        metadata: call.metadata
      };

      //importing the call Details to our db
      console.log("Importing call details to db", callDetails);
      await c.req.db
        .from('call_details')
        .upsert([callDetails] , {
          onConflict: 'call_id'
        });
    }
    
    const twilioService = TwilioService.getInstance();
    twilioService.setDependencies(c.req.db, c.req.env);

    // Create a promise that resolves when the operation is complete
    if(call && call.endReason !== 'unjoined'){
      try {
        const response = await twilioService.finishCall({...body , supabaseClient : c.req.db});
        console.log("Background finishCall completed successfully" , response);
        
        if(!response) {
          console.error("Background finishCall error: Missing response");
          return c.json({
            status: 'error',
            message: 'Internal Server Error',
          }, 500);
        }

        let {userId , TimeTaken , callId} = response;

        console.log("Call ID to delete: ", callId , userId , TimeTaken);

        if(!userId || !callId) {
          userId = call?.metadata?.['user_id'];
          callId = call?.callId;
        }

        if(!userId || !TimeTaken || !callId) {
         console.error("Background finishCall error: Missing userId or TimeTaken");
          return c.json({
            status: 'error',
            message: 'Internal Server Error',
          }, 500);
        }

        const timeInSeconds = Math.ceil(TimeTaken / 1000); // Convert ms to seconds
        console.log("Updating pricing for user", userId, "reducing time by", timeInSeconds, "seconds");

        // Use Postgres decrement operation
        const { data: pricing, error } = await c.req.db.rpc(
            'decrement_time_rem',
            { user_id_param: userId, seconds_to_subtract: timeInSeconds }
        );

        if(error){
            console.error("Error updating pricing:", error);
            throw new Error('Failed to update pricing');
        }
        console.log("Call deleted successfully", pricing);

        console.log("Successfully updated pricing. New time_rem:", pricing);
        twilioService.deleteCall(callId);

        
      } catch (error) {
        console.error("Background finishCall error:", error);
        
      }
    }
    // Immediately return success response
    return c.json({
      status: 'success',
      message: 'Call finish process initiated'
    });
  } catch (error) {
    console.error("Received /finish-call POST Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
}