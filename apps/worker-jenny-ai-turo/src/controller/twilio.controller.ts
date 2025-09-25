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
      is_single_twilio_account: isSingleTwilioAccount,
      enable_number_locking: enableNumberLocking
    } = body;

    console.log("Body", body);

    const twilioService = TwilioService.getInstance();
    twilioService.setDependencies(c.req.db, c.req.env);

    console.log("Call Config", callConfig);

    // if(!callConfig?.experimentalSettings){
    //   callConfig.experimentalSettings = {
    //     backSeatDriver: true,
    //     model: "o4-mini",
    //     enableFunctionInsertion: true,
    //   }
    // }


    console.log("Transfering call to: ", transferTo);
    
    const result = await twilioService.makeCall({
      callConfig,
      botId,
      toNumber,
      twilioFromNumber,
      userId,
      placeholders,
      tools: [],
      supabase: c.req.db,
      env: c.req.env,
      transferTo,
      isSingleTwilioAccount,
      configureBots: true,
      enableNumberLocking
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
    console.log("📋 Call metadata received:", call?.metadata);
    
    // if(event && call){
    //   console.log("inside event call");
    //   // we only subscribed to event = call.ended let's see
    //   const callDetails : CallDetails = {
    //     call_id: call.callId,
    //     created: call.created,
    //     joined: call.joined,
    //     ended: call.ended,
    //     end_reason: call.endReason,
    //     recording_enabled: call.recordingEnabled,
    //     join_timeout: call.joinTimeout,
    //     max_duration: call.maxDuration,
    //     voice: call.voice,
    //     temperature: call.temperature,
    //     time_exceeded_message: call.timeExceededMessage,
    //     short_summary: call.shortSummary,
    //     long_summary: call.summary,
    //     system_prompt: call.systemPrompt,
    //   };

    //   //importing the call Details to our db
    //   console.log("Importing call details to db", callDetails);
    //   const { data , error } = await c.req.db
    //     .from('call_details')
    //     .upsert([callDetails] , {
    //       onConflict: 'call_id'
    //     });

    //   if(error){
    //       console.error("❌ Database error importing call details:", error);
    //       console.error("❌ Call details data:", JSON.stringify(callDetails, null, 2));
    //       console.error("❌ Error details:", JSON.stringify(error, null, 2));
    //   } else {
    //       console.log("✅ Successfully imported call details to db");
    //   }
    // }
    
    const twilioService = TwilioService.getInstance();
    twilioService.setDependencies(c.req.db, c.req.env);

    // Extract campaign information with multiple fallback options
    let campaign_id = call?.metadata?.['campaign_id'];
    let contact_id = call?.metadata?.['contact_id'];
    let job_id = call?.metadata?.['job_id'];

    console.log("🔍 Extracted metadata:", { campaign_id, contact_id, job_id });
    console.log("📋 Full metadata received:", JSON.stringify(call?.metadata));

    // Fallback: Try to find campaign information from call_jobs table if not in metadata
    // if (!campaign_id || !contact_id) {
    //   console.log("🔄 Campaign metadata missing, attempting database lookup...");
    //   try {
    //     // First try to find by ultravox_call_id
    //     let jobData = null;
    //     let jobError = null;
        
    //     const { data: jobByCallId, error: errorByCallId } = await c.req.db
    //       .from('call_jobs')
    //       .select('campaign_id, contact_id, job_id, payload')
    //       .eq('ultravox_call_id', call.callId)
    //       .single();
        
    //     if (!errorByCallId && jobByCallId) {
    //       jobData = jobByCallId;
    //       console.log("✅ Found job by ultravox_call_id");
    //     } else if (job_id) {
    //       // If not found by call_id but we have job_id, try that
    //       console.log("🔄 Trying to find job by job_id:", job_id);
    //       const { data: jobByJobId, error: errorByJobId } = await c.req.db
    //         .from('call_jobs')
    //         .select('campaign_id, contact_id, job_id, payload')
    //         .eq('job_id', job_id)
    //         .single();
          
    //       if (!errorByJobId && jobByJobId) {
    //         jobData = jobByJobId;
    //         console.log("✅ Found job by job_id");
    //       } else {
    //         jobError = errorByJobId;
    //       }
    //     } else {
    //       // Last resort: check call_campaign_contacts table directly using call_id
    //       console.log("🔄 Trying to find contact by ultravox_call_id in call_campaign_contacts:");
    //       const { data: contactByCallId, error: errorContactByCallId } = await c.req.db
    //         .from('call_campaign_contacts')
    //         .select('campaign_id, contact_id')
    //         .eq('ultravox_call_id', call.callId)
    //         .single();
          
    //       if (!errorContactByCallId && contactByCallId) {
    //         campaign_id = contactByCallId.campaign_id;
    //         contact_id = contactByCallId.contact_id;
    //         console.log("✅ Found campaign data from call_campaign_contacts table");
    //       } else {
    //         console.log("❌ No matching contact found in call_campaign_contacts:", errorContactByCallId?.message);
    //       }
    //     }

    //     if (jobData) {
    //       campaign_id = campaign_id || jobData.campaign_id;
    //       contact_id = contact_id || jobData.contact_id;
    //       job_id = job_id || jobData.job_id;
          
    //       // Also check the payload for campaign metadata
    //       if (jobData.payload) {
    //         campaign_id = campaign_id || jobData.payload.campaign_id;
    //         contact_id = contact_id || jobData.payload.contact_id;
    //       }
          
    //       console.log("✅ Found campaign data from database:", { campaign_id, contact_id, job_id });
    //     } else if (!campaign_id || !contact_id) {
    //       console.log("❌ No matching job found in database:", jobError?.message);
    //     }
    //   } catch (dbError) {
    //     console.error("❌ Database lookup failed:", dbError);
    //   }
    // }

    // Update campaign contact status BEFORE pricing operations
    if (campaign_id && contact_id) {
      console.log("📞 Processing campaign contact update:", { campaign_id, contact_id, callId: call.callId });
      
      // Calculate call duration from joined to ended timestamps
      let callDuration = 0;
      if (call.joined && call.ended) {
        const joinedTime = new Date(call.joined).getTime();
        const endedTime = new Date(call.ended).getTime();
        callDuration = Math.floor((endedTime - joinedTime) / 1000); // Duration in seconds
      }

      // Determine call status based on call details and duration
      let callStatus = 'completed';
      
      // If call duration is very short (less than 5 seconds), likely failed/no answer
      if (!call.joined && call.ended) {
        callStatus = 'unjoined';
        console.log("📞 Call never joined but ended, marking as failed");
      }
      // If call has reasonable duration, mark as completed
      else if (callDuration) {
        callStatus = 'completed';
        console.log("📞 Call had reasonable duration, marking as completed");
      }

      const updateData: any = {
        call_status: callStatus,
        completed_at: new Date().toISOString(),
        call_duration: callDuration
      };

      // Add call summary if available
      if (call.shortSummary) {
        updateData.call_summary = call.shortSummary;
      }
      if (call.summary) {
        updateData.call_notes = call.summary;
      }

      try {
        console.log("📝 Updating campaign contact with data:", updateData);
        
        // Update the campaign contact
        const { error: contactUpdateError } = await c.req.db
          .from('call_campaign_contacts')
          .update(updateData)
          .eq('contact_id', contact_id);

        if (contactUpdateError) {
          console.error("❌ Error updating campaign contact:", contactUpdateError);
        } else {
          console.log("✅ Successfully updated campaign contact to completed status");
          console.log("📊 Contact update details:", {
            contact_id,
            campaign_id,
            call_status: updateData.call_status,
            call_duration: updateData.call_duration,
            has_summary: !!updateData.call_summary
          });
          
          // Check if all contacts in the campaign are completed and update campaign status
          console.log("🔄 Checking if campaign should be marked as completed...");
          try {
            const { CampaignsService } = await import('../services/campaigns.service');
            const campaignsService = CampaignsService.getInstance();
            campaignsService.setDependencies(c.req.db, c.req.env);

            // First check if this is a number-locked campaign
            const isNumberLocked = await campaignsService.isNumberLockedCampaign(campaign_id);
            console.log(`🔒 Campaign number locking: ${isNumberLocked ? 'ENABLED' : 'DISABLED'}`);

            if (isNumberLocked) {
              // Try to queue the next contact if number locking is enabled
              console.log(`🔄 Number-locked campaign detected. Checking for next contact to queue...`);
              const nextContact = await campaignsService.getNextPendingContact(campaign_id);

              if (nextContact) {
                console.log(`📞 Queueing next contact: ${nextContact.contact_phone}`);
                const queueResult = await campaignsService.queueSingleContact(campaign_id, nextContact);

                if (queueResult.success) {
                  console.log(`✅ Successfully queued next contact: ${nextContact.contact_phone} (job_id: ${queueResult.job_id})`);
                } else {
                  console.error(`❌ Failed to queue next contact: ${queueResult.message}`);
                }
              } else {
                console.log(`📋 No more pending contacts for campaign ${campaign_id}`);
              }
            }

            // Now check if campaign should be marked as completed
            const statusCheckResult = await campaignsService.checkAndUpdateCampaignStatus(campaign_id);
            console.log("📊 Campaign status check result:", statusCheckResult);

            if (statusCheckResult.status === 'completed') {
              console.log(`🎉 Campaign ${campaign_id} has been automatically marked as completed!`);
            }
          } catch (campaignCheckError) {
            console.error("❌ Error checking campaign status:", campaignCheckError);
            // Don't fail the webhook if campaign status check fails
          }
        }

        // Update call job status
        if (job_id) {
          const { error: jobUpdateError } = await c.req.db
            .from('call_jobs')
            .update({
              status: 'completed',
              result: {
                call_id: call.callId,
                duration: callDuration,
                summary: call.shortSummary || call.summary,
                end_reason: call.endReason
              },
              updated_at: new Date().toISOString()
            })
            .eq('job_id', job_id);

          if (jobUpdateError) {
            console.error("❌ Error updating call job:", jobUpdateError);
          } else {
            console.log("✅ Successfully updated call job to completed status");
          }
        }
      } catch (updateError) {
        console.error("❌ Critical error updating campaign contact:", updateError);
      }
    } else {
      console.log("ℹ️ No campaign data found - this may be a regular (non-campaign) call");
    }

    // Notify user webhooks before finishing the call
    try {
      let userId = call?.metadata?.['user_id'] || call?.metadata?.['userId'];
      let botId = call?.metadata?.['bot_id'];

      if (userId) {
        console.log(`🔔 Checking for user webhooks to notify for call.ended event (user: ${userId})`);

        // Import and initialize webhooks service
        const { WebhooksService } = await import('../services/webhooks.service');
        const webhooksService = WebhooksService.getInstance();
        webhooksService.setDependencies(c.req.db, c.req.env);

        // Get user webhooks that listen for 'call.ended' events
        const webhooks = await webhooksService.getUserWebhooksForEvent(userId, 'call.ended', botId);

        if (webhooks.length > 0) {
          console.log(`📤 Found ${webhooks.length} webhook(s) to notify`);

          // Calculate call duration if available
          let callDuration = 0;
          if (call.joined && call.ended) {
            const joinedTime = new Date(call.joined).getTime();
            const endedTime = new Date(call.ended).getTime();
            callDuration = Math.floor((endedTime - joinedTime) / 1000); // Duration in seconds
          }

          // Prepare webhook payload with comprehensive call information
          const webhookPayload = {
            event: 'call.ended',
            timestamp: new Date().toISOString(),
            call: {
              callId: call.callId,
              created: call.created,
              joined: call.joined,
              ended: call.ended,
              endReason: call.endReason,
              duration: callDuration, // Duration in seconds
              shortSummary: call.shortSummary,
              summary: call.summary,
              recordingEnabled: call.recordingEnabled,
              joinTimeout: call.joinTimeout,
              maxDuration: call.maxDuration,
              voice: call.voice,
              temperature: call.temperature,
              timeExceededMessage: call.timeExceededMessage,
              systemPrompt: call.systemPrompt,
              metadata: call.metadata
            },
            user: {
              userId: userId,
              botId: botId
            },
            // Add campaign information if available (for campaign calls)
            ...(campaign_id && {
              campaign: {
                campaign_id,
                contact_id,
                job_id
              }
            })
          };

          // Send webhooks in parallel (non-blocking)
          webhooksService.notifyWebhooks(webhooks, webhookPayload)
            .then(result => {
              console.log(`🔔 Webhook notifications result: ${result.success} success, ${result.failed} failed`);
            })
            .catch(error => {
              console.error('❌ Error sending webhook notifications:', error);
            });
        } else {
          console.log(`📭 No webhooks found for user ${userId} with 'call.ended' event`);
        }
      } else {
        console.log('⚠️ No user ID found in call metadata, skipping webhook notifications');
      }
    } catch (webhookError) {
      console.error('❌ Error processing webhook notifications:', webhookError);
      // Continue with the rest of the function even if webhook notifications fail
    }

    // Create a promise that resolves when the operation is complete
    if(call && call.endReason !== 'unjoined'){
      try {
        console.log(`🔚 Call ending - CallID: ${call.callId}, EndReason: ${call.endReason}`);
        const response = await twilioService.finishCall({...body , supabaseClient : c.req.db});
        console.log("Background finishCall completed successfully" , response);
        
        if(!response) {
          console.error("Background finishCall error: Missing response");
          // Continue with the rest of the process even if twilioService.finishCall fails
        }

        let userId = response?.userId || call?.metadata?.['user_id'] || call?.metadata?.['userId'];
        let TimeTaken = response?.TimeTaken;
        let callId = response?.callId || call?.callId;

        console.log("💰 Processing pricing update:", { userId, TimeTaken, callId });

        // Only update pricing if we have the necessary data
        if(userId && TimeTaken && callId) {
          try {
            const timeInSeconds = Math.ceil(TimeTaken / 1000); // Convert ms to seconds
            console.log("Updating pricing for user", userId, "reducing time by", timeInSeconds, "seconds");

            // Use Postgres decrement operation
            const { data: pricing, error } = await c.req.db.rpc(
                'decrement_time_rem',
                { user_id_param: userId, seconds_to_subtract: timeInSeconds }
            );

            if(error){
                console.error("❌ Error updating pricing:", error);
            } else {
              console.log("✅ Successfully updated pricing. New time_rem:", pricing);
            }
            
            twilioService.deleteCall(callId);
            console.log("🗑️ Call cleanup completed");
          } catch (pricingError) {
            console.error("❌ Pricing update failed but continuing:", pricingError);
          }
        } else {
          console.log("⚠️ Skipping pricing update due to missing data:", { userId, TimeTaken, callId });
          // Still try to clean up the call if we have the callId
          if (callId) {
            twilioService.deleteCall(callId);
            console.log("🗑️ Call cleanup completed (without pricing update)");
          }
        }

        
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