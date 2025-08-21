import { Context } from "hono";
import { randomUUID } from "crypto";
import { CampaignsService } from "../services/campaigns.service";

/**
 * Convert a datetime from user input to UTC, interpreting it as being in the target timezone
 * @param isoString - ISO string from frontend (user's local time)
 * @param targetTimezone - IANA timezone string (e.g., "Asia/Kolkata")
 * @returns ISO string representing the correct UTC time
 */
function convertToTargetTimezoneUTC(datetimeString: string, targetTimezone: string): string {
  try {
    // The input is now a raw datetime string like "2025-08-21T15:30"
    // We need to interpret this as being in the target timezone
    
    // Parse the datetime components from the raw string
    const [datePart, timePart] = datetimeString.includes('T') 
      ? datetimeString.split('T') 
      : [datetimeString.split(' ')[0], datetimeString.split(' ')[1] || '00:00'];
    
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = (timePart || '00:00').split(':').map(Number);
    
    // Create a date in UTC representing this time
    let testUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    
    // Use iterative approach to find the correct UTC time
    // that when displayed in target timezone shows the user's intended time
    for (let attempt = 0; attempt < 2; attempt++) {
      const displayedTime = new Date(testUTC.toLocaleString("en-US", { 
        timeZone: targetTimezone 
      }));
      
      const targetTime = new Date(year, month - 1, day, hour, minute, 0);
      const offsetMs = targetTime.getTime() - displayedTime.getTime();
      
      if (Math.abs(offsetMs) < 60000) { // Within 1 minute, good enough
        break;
      }
      
      testUTC = new Date(testUTC.getTime() + offsetMs);
    }
    
    return testUTC.toISOString();
  } catch (error) {
    console.error('Error converting timezone:', error);
    // Fallback: treat as UTC
    return new Date(datetimeString + (datetimeString.includes('T') ? '' : 'T00:00:00') + '.000Z').toISOString();
  }
}

/**
 * POST /campaigns
 * Body: { campaign_name, bot_id, bot_name, twilio_phone_number, system_prompt, voice_settings, field_mappings, contacts, notes?, scheduling? }
 * Returns: { campaign_id, status }
 */
export async function createCampaign(c: Context) {
  try {
    const payload = await c.req.json();
    const {
      campaign_name,
      bot_id,
      bot_name,
      twilio_phone_number,
      twilio_phone_numbers,
      system_prompt,
      voice_settings,
      field_mappings,
      contacts,
      notes,
      user_id,
      scheduling,
      campaign_settings,
    } = payload;

    if (!campaign_name || !bot_id || !contacts || !Array.isArray(contacts)) {
      return c.json(
        {
          status: "error",
          message: "Missing required fields: campaign_name, bot_id, contacts",
        },
        400
      );
    }

    const db = c.req.db;
    const campaign_id = randomUUID();

    // Prepare campaign data with optional scheduling fields
    const campaignData: any = {
      campaign_id,
      user_id,
      campaign_name,
      bot_id,
      bot_name,
      twilio_phone_number,
      twilio_phone_numbers: twilio_phone_numbers || [twilio_phone_number], // Store array of numbers
      system_prompt,
      voice_settings,
      field_mappings,
      total_contacts: contacts.length,
      notes,
      status: "pending",
      campaign_settings: campaign_settings || {},
    };

    // Add scheduling fields if provided
    if (scheduling) {
      // Convert the scheduled time from the selected timezone to UTC
      // The frontend sends the time as entered by the user (in their browser's timezone)
      // but we need to interpret it as if it were in the selected timezone
      if (scheduling.scheduled_start_time && scheduling.timezone) {
        campaignData.scheduled_start_time = convertToTargetTimezoneUTC(
          scheduling.scheduled_start_time, 
          scheduling.timezone
        );
      } else {
        campaignData.scheduled_start_time = scheduling.scheduled_start_time;
      }
      
      campaignData.timezone = scheduling.timezone || "UTC";
      campaignData.is_recurring = scheduling.is_recurring || false;
      campaignData.auto_start = scheduling.auto_start || false;

      if (scheduling.is_recurring) {
        campaignData.recurring_type = scheduling.recurring_type || "none";
        campaignData.recurring_interval = scheduling.recurring_interval || 1;
        campaignData.recurring_until = scheduling.recurring_until;
        campaignData.max_executions = scheduling.max_executions;
      }
    }

    // Create campaign
    const { data: campaignResult, error: campaignError } = await db
      .from("call_campaigns")
      .insert([campaignData])
      .select()
      .single();

    if (campaignError) {
      console.error("Campaign creation error:", campaignError);
      return c.json(
        {
          status: "error",
          message: "Failed to create campaign",
          error: campaignError.message,
        },
        500
      );
    }

    // Create contacts
    const contactsToInsert = contacts.map((contact: any) => ({
      contact_id: randomUUID(),
      campaign_id,
      contact_name: contact.name || contact.contact_name,
      contact_phone: contact.phone || contact.phone_number,
      contact_email: contact.email,
      contact_data: contact,
      call_status: "pending",
    }));

    const { error: contactsError } = await db
      .from("call_campaign_contacts")
      .insert(contactsToInsert);

    if (contactsError) {
      console.error("Contacts creation error:", contactsError);
      // Rollback campaign creation
      await db.from("call_campaigns").delete().eq("campaign_id", campaign_id);
      return c.json(
        {
          status: "error",
          message: "Failed to create contacts",
          error: contactsError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      campaign_id,
      message: "Campaign created successfully",
    });
  } catch (error) {
    console.error("Create Campaign Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to create campaign",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * GET /campaigns?user_id=...
 * Returns: { status, campaigns }
 */
export async function getCampaigns(c: Context) {
  try {
    const user_id = c.req.query("user_id");

    if (!user_id) {
      return c.json(
        {
          status: "error",
          message: "Missing user_id",
        },
        400
      );
    }

    const db = c.req.db;

    const { data, error } = await db
      .from("call_campaigns")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get Campaigns Error:", error);
      return c.json(
        {
          status: "error",
          message: "Failed to fetch campaigns",
          error: error.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      campaigns: data || [],
    });
  } catch (error) {
    console.error("Get Campaigns Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to fetch campaigns",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * GET /campaigns/:campaign_id
 * Returns: { status, campaign, contacts }
 */
export async function getCampaign(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const db = c.req.db;

    // Get campaign details
    const { data: campaignData, error: campaignError } = await db
      .from("call_campaigns")
      .select("*")
      .eq("campaign_id", campaign_id)
      .single();

    if (campaignError || !campaignData) {
      return c.json(
        {
          status: "error",
          message: "Campaign not found",
        },
        404
      );
    }

    // Get campaign contacts
    const { data: contactsData, error: contactsError } = await db
      .from("call_campaign_contacts")
      .select("*")
      .eq("campaign_id", campaign_id)
      .order("created_at", { ascending: true });

    if (contactsError) {
      console.error("Get Campaign Contacts Error:", contactsError);
      return c.json(
        {
          status: "error",
          message: "Failed to fetch campaign contacts",
          error: contactsError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      campaign: campaignData,
      contacts: contactsData || [],
    });
  } catch (error) {
    console.error("Get Campaign Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to fetch campaign",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * POST /campaigns/:campaign_id/start
 * Starts campaign execution
 * Returns: { status, message }
 */
export async function startCampaign(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const db = c.req.db;
    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(db, c.req.env);

    // Update campaign status
    const { error: updateError } = await db
      .from("call_campaigns")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      .eq("campaign_id", campaign_id);

    if (updateError) {
      console.error("Start Campaign Error:", updateError);
      return c.json(
        {
          status: "error",
          message: "Failed to start campaign",
          error: updateError.message,
        },
        500
      );
    }

    // Queue all campaign calls
    const queueResult = await campaignsService.queueCampaignCalls(campaign_id);

    if (!queueResult.success) {
      return c.json(
        {
          status: "error",
          message: queueResult.message,
          error: queueResult.error,
        },
        500
      );
    }

    return c.json({
      status: "success",
      message: `Campaign started successfully. ${queueResult.queued_count} calls queued.`,
    });
  } catch (error) {
    console.error("Start Campaign Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to start campaign",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * POST /campaigns/:campaign_id/stop
 * Stops campaign execution
 * Returns: { status, message }
 */
export async function stopCampaign(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const db = c.req.db;

    // Update campaign status
    const { error: updateError } = await db
      .from("call_campaigns")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("campaign_id", campaign_id);

    if (updateError) {
      console.error("Stop Campaign Error:", updateError);
      return c.json(
        {
          status: "error",
          message: "Failed to stop campaign",
          error: updateError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      message: "Campaign stopped successfully",
    });
  } catch (error) {
    console.error("Stop Campaign Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to stop campaign",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * PUT /campaigns/:campaign_id/contacts/:contact_id
 * Updates contact call status and results
 * Body: { call_status?, ultravox_call_id?, call_duration?, call_summary?, call_notes?, interest_level?, error_message? }
 * Returns: { status, message }
 */
export async function updateContact(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");
    const contact_id = c.req.param("contact_id");
    const payload = await c.req.json();

    if (!campaign_id || !contact_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id or contact_id",
        },
        400
      );
    }

    const db = c.req.db;

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    // Add optional fields if provided
    if (payload.call_status) updateData.call_status = payload.call_status;
    if (payload.ultravox_call_id)
      updateData.ultravox_call_id = payload.ultravox_call_id;
    if (payload.call_duration) updateData.call_duration = payload.call_duration;
    if (payload.call_summary) updateData.call_summary = payload.call_summary;
    if (payload.call_notes) updateData.call_notes = payload.call_notes;
    if (payload.interest_level)
      updateData.interest_level = payload.interest_level;
    if (payload.error_message) updateData.error_message = payload.error_message;

    // Set timing fields based on status
    if (payload.call_status === "queued") {
      updateData.queued_at = new Date().toISOString();
    } else if (payload.call_status === "in_progress") {
      updateData.started_at = new Date().toISOString();
    } else if (["completed", "failed"].includes(payload.call_status)) {
      updateData.completed_at = new Date().toISOString();
    }

    const { error: updateError } = await db
      .from("call_campaign_contacts")
      .update(updateData)
      .eq("contact_id", contact_id)
      .eq("campaign_id", campaign_id);

    if (updateError) {
      console.error("Update Contact Error:", updateError);
      return c.json(
        {
          status: "error",
          message: "Failed to update contact",
          error: updateError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      message: "Contact updated successfully",
    });
  } catch (error) {
    console.error("Update Contact Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to update contact",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * GET /campaigns/:campaign_id/stats
 * Gets campaign statistics
 * Returns: { status, stats }
 */
export async function getCampaignStats(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(c.req.db, c.req.env);

    const stats = await campaignsService.getCampaignStats(campaign_id);

    return c.json({
      status: "success",
      stats,
    });
  } catch (error) {
    console.error("Get Campaign Stats Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to get campaign stats",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * DELETE /campaigns/:campaign_id
 * Deletes a campaign and all its contacts
 * Returns: { status, message }
 */
export async function deleteCampaign(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const db = c.req.db;

    // Delete campaign (contacts will be deleted automatically due to cascade)
    const { error: deleteError } = await db
      .from("call_campaigns")
      .delete()
      .eq("campaign_id", campaign_id);

    if (deleteError) {
      console.error("Delete Campaign Error:", deleteError);
      return c.json(
        {
          status: "error",
          message: "Failed to delete campaign",
          error: deleteError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    console.error("Delete Campaign Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to delete campaign",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * PUT /campaigns/:campaign_id/schedule
 * Updates campaign scheduling settings
 * Body: { scheduled_start_time?, timezone?, is_recurring?, recurring_type?, recurring_interval?, recurring_until?, max_executions?, auto_start? }
 * Returns: { status, message }
 */
export async function updateCampaignSchedule(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");
    const payload = await c.req.json();

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const db = c.req.db;

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    // Add scheduling fields if provided
    if (payload.scheduled_start_time !== undefined)
      updateData.scheduled_start_time = payload.scheduled_start_time;
    if (payload.timezone !== undefined) updateData.timezone = payload.timezone;
    if (payload.is_recurring !== undefined)
      updateData.is_recurring = payload.is_recurring;
    if (payload.auto_start !== undefined)
      updateData.auto_start = payload.auto_start;

    if (payload.is_recurring) {
      if (payload.recurring_type !== undefined)
        updateData.recurring_type = payload.recurring_type;
      if (payload.recurring_interval !== undefined)
        updateData.recurring_interval = payload.recurring_interval;
      if (payload.recurring_until !== undefined)
        updateData.recurring_until = payload.recurring_until;
      if (payload.max_executions !== undefined)
        updateData.max_executions = payload.max_executions;
    }

    const { error: updateError } = await db
      .from("call_campaigns")
      .update(updateData)
      .eq("campaign_id", campaign_id);

    if (updateError) {
      console.error("Update Campaign Schedule Error:", updateError);
      return c.json(
        {
          status: "error",
          message: "Failed to update campaign schedule",
          error: updateError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      message: "Campaign schedule updated successfully",
    });
  } catch (error) {
    console.error("Update Campaign Schedule Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to update campaign schedule",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * GET /campaigns/scheduled
 * Gets campaigns that are ready to be executed based on their schedule
 * Query: user_id?, limit?
 * Returns: { status, campaigns }
 */
export async function getScheduledCampaigns(c: Context) {
  try {
    const user_id = c.req.query("user_id");
    const limit = parseInt(c.req.query("limit") || "50");
    const now = new Date().toISOString();

    const db = c.req.db;

    let query = db
      .from("call_campaigns")
      .select("*")
      .eq("auto_start", true)
      .eq("status", "pending")
      .lte("scheduled_start_time", now)
      .order("scheduled_start_time", { ascending: true })
      .limit(limit);

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Get Scheduled Campaigns Error:", error);
      return c.json(
        {
          status: "error",
          message: "Failed to fetch scheduled campaigns",
          error: error.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      campaigns: data || [],
    });
  } catch (error) {
    console.error("Get Scheduled Campaigns Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to fetch scheduled campaigns",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * POST /campaigns/:campaign_id/executions
 * Creates a new execution record for a recurring campaign
 * Returns: { status, execution_id }
 */
export async function createCampaignExecution(c: Context) {
  try {
    const campaign_id = c.req.param("campaign_id");

    if (!campaign_id) {
      return c.json(
        {
          status: "error",
          message: "Missing campaign_id",
        },
        400
      );
    }

    const db = c.req.db;
    const execution_id = randomUUID();

    // Get campaign details
    const { data: campaignData, error: campaignError } = await db
      .from("call_campaigns")
      .select("*")
      .eq("campaign_id", campaign_id)
      .single();

    if (campaignError || !campaignData) {
      return c.json(
        {
          status: "error",
          message: "Campaign not found",
        },
        404
      );
    }

    // Create execution record
    const { error: executionError } = await db
      .from("campaign_executions")
      .insert([
        {
          execution_id,
          campaign_id,
          scheduled_time: new Date().toISOString(),
          status: "pending",
          total_contacts: campaignData.total_contacts,
        },
      ]);

    if (executionError) {
      console.error("Create Campaign Execution Error:", executionError);
      return c.json(
        {
          status: "error",
          message: "Failed to create campaign execution",
          error: executionError.message,
        },
        500
      );
    }

    return c.json({
      status: "success",
      execution_id,
      message: "Campaign execution created successfully",
    });
  } catch (error) {
    console.error("Create Campaign Execution Error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to create campaign execution",
        error: error instanceof Error ? error.message : error,
      },
      500
    );
  }
}

/**
 * POST /campaigns/process-answers
 * Processes call transcripts/summaries with custom questions using Gemini API
 * Body: { contactIds, botId, geminiApiKey }
 * Returns: { message, processedCount, totalCount, errors? }
 */
export async function processCallAnswers(c: Context) {
  try {
    const { contactIds, botId, geminiApiKey } = await c.req.json();

    console.log("Worker API: Received request with:", {
      contactIds: contactIds?.length || 0,
      botId,
      hasGeminiKey: !!geminiApiKey,
    });

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return c.json({ error: "Contact IDs array is required" }, 400);
    }

    if (!botId) {
      return c.json({ error: "Bot ID is required" }, 400);
    }

    if (!geminiApiKey) {
      return c.json({ error: "Gemini API key is required" }, 400);
    }

    const db = c.req.db;

    // Get bot custom questions
    const { data: bot, error: botError } = await db
      .from("bots")
      .select("custom_questions")
      .eq("id", botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: "Bot not found" }, 404);
    }

    const customQuestions = bot.custom_questions || [];
    const enabledQuestions = customQuestions.filter((q: any) => q.enabled);

    if (enabledQuestions.length === 0) {
      return c.json(
        { error: "No enabled custom questions found for this bot" },
        400
      );
    }

    // First, let's check what contacts exist regardless of status
    const { data: allContactsCheck, error: checkError } = await db
      .from("call_campaign_contacts")
      .select("contact_id, call_status, call_summary")
      .in("contact_id", contactIds);

    console.log("Worker API: All contacts check:", allContactsCheck);
    console.log("Worker API: Check error:", checkError);

    // Get contacts with their call data
    const { data: contacts, error: contactsError } = await db
      .from("call_campaign_contacts")
      .select(
        "contact_id, call_summary, ultravox_call_id, ai_processed_answers, ai_answers_generated_at, call_status"
      )
      .in("contact_id", contactIds);
    // Note: Removed status filter for now to debug

    if (contactsError || !contacts) {
      console.log("Worker API: Database error:", contactsError);
      return c.json({ error: "Failed to fetch contacts" }, 500);
    }

    console.log("Worker API: Found contacts:", contacts.length);
    console.log("Worker API: Contact IDs requested:", contactIds);
    console.log(
      "Worker API: Enabled questions:",
      enabledQuestions.map((q: any) => ({ id: q.id, question: q.question }))
    );
    console.log("Worker API: Raw contacts data:", contacts);

    // Filter contacts that need processing for the enabled questions
    const contactsToProcess = contacts.filter((contact: any) => {
      console.log(
        "Worker API: Checking contact:",
        contact.contact_id,
        "AI Answers:",
        contact.ai_processed_answers,
        "Type:",
        typeof contact.ai_processed_answers
      );

      // If no AI answers at all, needs processing
      if (!contact.ai_processed_answers) {
        console.log("Worker API: No ai_processed_answers - needs processing");
        return true;
      }

      const aiAnswers = contact.ai_processed_answers;
      const hasAnswers = Object.keys(aiAnswers).length > 0;

      if (!hasAnswers) {
        console.log(
          "Worker API: Empty ai_processed_answers - needs processing"
        );
        return true;
      }

      // Check if any enabled question is missing an answer
      const missingAnswers = enabledQuestions.some((question: any) => {
        const hasAnswer =
          aiAnswers[question.id] && aiAnswers[question.id].answer;
        console.log(
          `Worker API: Question ${question.id}: hasAnswer = ${hasAnswer}, answer data:`,
          aiAnswers[question.id]
        );
        return !hasAnswer;
      });

      console.log("Worker API: Missing answers:", missingAnswers);
      return missingAnswers;
    });

    console.log("Worker API: Contacts to process:", contactsToProcess.length);

    if (contactsToProcess.length === 0) {
      console.log("Worker API: No contacts to process");

      // Check if no contacts were found at all vs all already processed
      if (contacts.length === 0) {
        return c.json({
          message:
            "No contacts found with the provided IDs. Check the contact IDs and call status.",
          processedCount: 0,
          totalCount: 0,
          debug: {
            requestedContactIds: contactIds,
            contactsFound: contacts.length,
            allContactsFound: allContactsCheck?.length || 0,
            allContactsDetails: allContactsCheck || [],
            enabledQuestions: enabledQuestions.map((q: any) => ({
              id: q.id,
              question: q.question,
            })),
          },
        });
      }

      return c.json({
        message: "All selected contacts already have processed answers",
        processedCount: 0,
        totalCount: contacts.length,
      });
    }

    // Process with Gemini API
    let processedCount = 0;
    const errors: string[] = [];

    // Process each contact
    for (const contact of contactsToProcess) {
      try {
        // Fetch the full transcript for this contact if ultravox_call_id exists
        let fullTranscript = "";
        if (contact.ultravox_call_id) {
          try {
            const { CallTranscriptsService } = await import(
              "../services/call-transcripts.service"
            );
            const { getSupabaseClient } = await import(
              "../lib/supabase/client"
            );
            const { getEnv } = await import("../config/env");

            const env = getEnv(c.req.env);
            const supabaseClient = getSupabaseClient(env);
            const transcriptsService = CallTranscriptsService.getInstance(
              env,
              supabaseClient
            );

            console.log(
              `Worker API: Fetching transcript for ultravox_call_id: ${contact.ultravox_call_id}`
            );

            // Fetch all transcript messages
            let allMessages: any[] = [];
            let cursor: string | null = null;
            let hasMore = true;

            while (hasMore) {
              const transcriptResponse =
                await transcriptsService.getCallTranscript(
                  contact.ultravox_call_id,
                  100, // pageSize
                  cursor || undefined
                );

              if (transcriptResponse && transcriptResponse.results) {
                allMessages.push(...transcriptResponse.results);
                cursor = transcriptResponse.next;
                hasMore = !!transcriptResponse.next;
              } else {
                hasMore = false;
              }
            }

            // Convert transcript messages to readable text
            if (allMessages.length > 0) {
              fullTranscript = allMessages
                .map((msg: any) => {
                  const role =
                    msg.role === "MESSAGE_ROLE_USER" ||
                    msg.role === "user" ||
                    msg.role === "USER"
                      ? "USER"
                      : "AGENT";
                  return `${role}: ${msg.text}`;
                })
                .join("\n\n");
            }

            console.log(
              `Worker API: Retrieved ${allMessages.length} transcript messages for contact ${contact.contact_id}`
            );
          } catch (transcriptError) {
            console.error(
              `Worker API: Error fetching transcript for contact ${contact.contact_id}:`,
              transcriptError
            );
            // Continue processing without transcript
          }
        }

        // Build the analysis prompt with both summary and transcript
        const questionsText = enabledQuestions
          .map(
            (q: any, index: number) =>
              `${index + 1}. ${q.question} (ID: ${q.id})`
          )
          .join("\n");

        const prompt = `You are an AI assistant that analyzes phone call transcripts and summaries to extract specific information.

CALL SUMMARY:
${contact.call_summary || "No summary available"}

${
  fullTranscript
    ? `FULL CALL TRANSCRIPT:
${fullTranscript}

`
    : ""
}QUESTIONS TO ANSWER:
${questionsText}

INSTRUCTIONS:
- Analyze the call ${fullTranscript ? "transcript and summary" : "summary"} to answer each question
- If the information is clearly stated, provide the answer with "high" confidence
- If you can infer the answer with reasonable certainty, use "medium" confidence  
- If the information is not available or unclear, state "Not specified in the conversation" with "low" confidence
- Be specific and concise in your answers
- Use the full transcript when available for more detailed analysis

RESPONSE FORMAT (JSON):
{
  "q1": {
    "question": "Question text here",
    "answer": "Your answer here", 
    "confidence": "high|medium|low"
  }
}

Please respond with valid JSON only, no additional text.`;

        console.log("Worker API: Prompt:", prompt);

        // Call Gemini API
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: prompt }],
                },
              ],
              generationConfig: {
                temperature: 0.2,
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 2048,
                stopSequences: [],
                candidateCount: 1,
              },
            }),
          }
        );

        if (!geminiResponse.ok) {
          throw new Error(
            `Gemini API responded with status: ${geminiResponse.status}`
          );
        }

        const geminiResult = (await geminiResponse.json()) as any;
        const content = geminiResult.candidates?.[0]?.content;
        const text = content?.parts?.[0]?.text;

        if (!text) {
          throw new Error("No text found in Gemini response");
        }

        // Parse the response
        let cleanResponse = text.trim();
        if (cleanResponse.startsWith("```json")) {
          cleanResponse = cleanResponse
            .replace(/```json\n?/, "")
            .replace(/\n?```$/, "");
        } else if (cleanResponse.startsWith("```")) {
          cleanResponse = cleanResponse
            .replace(/```\n?/, "")
            .replace(/\n?```$/, "");
        }

        const parsed = JSON.parse(cleanResponse);
        const processedAnswers: any = {};

        // Validate and structure the response
        enabledQuestions.forEach((question: any) => {
          const answer = parsed[question.id];
          if (answer && typeof answer === "object") {
            processedAnswers[question.id] = {
              question: question.question,
              answer: answer.answer || "No answer provided",
              confidence: ["high", "medium", "low"].includes(answer.confidence)
                ? answer.confidence
                : "low",
            };
          } else {
            processedAnswers[question.id] = {
              question: question.question,
              answer: "Could not process answer",
              confidence: "low",
            };
          }
        });

        // Merge new answers with existing ones
        const existingAnswers = contact.ai_processed_answers || {};
        const mergedAnswers = { ...existingAnswers, ...processedAnswers };

        // Update the contact with processed answers
        const { error: updateError } = await db
          .from("call_campaign_contacts")
          .update({
            ai_processed_answers: mergedAnswers,
            ai_answers_generated_at: new Date().toISOString(),
          })
          .eq("contact_id", contact.contact_id);

        if (updateError) {
          errors.push(
            `Failed to save answers for contact ${contact.contact_id}: ${updateError.message}`
          );
        } else {
          processedCount++;
        }

        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error processing contact ${contact.contact_id}:`, error);
        errors.push(
          `Failed to process contact ${contact.contact_id}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    return c.json({
      message: `Successfully processed ${processedCount} out of ${contactsToProcess.length} contacts`,
      processedCount,
      totalCount: contacts.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in worker process-answers API:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
