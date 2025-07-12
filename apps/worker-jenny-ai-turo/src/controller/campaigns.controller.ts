import { Context } from "hono";
import { randomUUID } from "crypto";
import { CampaignsService } from "../services/campaigns.service";

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
      system_prompt,
      voice_settings,
      field_mappings,
      contacts,
      notes,
      user_id,
      scheduling
    } = payload;

    if (!campaign_name || !bot_id || !contacts || !Array.isArray(contacts)) {
      return c.json({ 
        status: 'error', 
        message: 'Missing required fields: campaign_name, bot_id, contacts' 
      }, 400);
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
      system_prompt,
      voice_settings,
      field_mappings,
      total_contacts: contacts.length,
      notes,
      status: 'pending'
    };

    // Add scheduling fields if provided
    if (scheduling) {
      campaignData.scheduled_start_time = scheduling.scheduled_start_time;
      campaignData.timezone = scheduling.timezone || 'UTC';
      campaignData.is_recurring = scheduling.is_recurring || false;
      campaignData.auto_start = scheduling.auto_start || false;
      
      if (scheduling.is_recurring) {
        campaignData.recurring_type = scheduling.recurring_type || 'none';
        campaignData.recurring_interval = scheduling.recurring_interval || 1;
        campaignData.recurring_until = scheduling.recurring_until;
        campaignData.max_executions = scheduling.max_executions;
      }
    }

    // Create campaign
    const { data: campaignResult, error: campaignError } = await db
      .from('call_campaigns')
      .insert([campaignData])
      .select()
      .single();

    if (campaignError) {
      console.error('Campaign creation error:', campaignError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to create campaign', 
        error: campaignError.message 
      }, 500);
    }

    // Create contacts
    const contactsToInsert = contacts.map((contact: any) => ({
      contact_id: randomUUID(),
      campaign_id,
      contact_name: contact.name || contact.contact_name,
      contact_phone: contact.phone || contact.phone_number,
      contact_email: contact.email,
      contact_data: contact,
      call_status: 'pending'
    }));

    const { error: contactsError } = await db
      .from('call_campaign_contacts')
      .insert(contactsToInsert);

    if (contactsError) {
      console.error('Contacts creation error:', contactsError);
      // Rollback campaign creation
      await db.from('call_campaigns').delete().eq('campaign_id', campaign_id);
      return c.json({ 
        status: 'error', 
        message: 'Failed to create contacts', 
        error: contactsError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      campaign_id,
      message: 'Campaign created successfully'
    });

  } catch (error) {
    console.error('Create Campaign Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to create campaign', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * GET /campaigns?user_id=...
 * Returns: { status, campaigns }
 */
export async function getCampaigns(c: Context) {
  try {
    const user_id = c.req.query('user_id');
    
    if (!user_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing user_id' 
      }, 400);
    }

    const db = c.req.db;
    
    const { data, error } = await db
      .from('call_campaigns')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Get Campaigns Error:', error);
      return c.json({ 
        status: 'error', 
        message: 'Failed to fetch campaigns', 
        error: error.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      campaigns: data || []
    });

  } catch (error) {
    console.error('Get Campaigns Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to fetch campaigns', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * GET /campaigns/:campaign_id
 * Returns: { status, campaign, contacts }
 */
export async function getCampaign(c: Context) {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const db = c.req.db;
    
    // Get campaign details
    const { data: campaignData, error: campaignError } = await db
      .from('call_campaigns')
      .select('*')
      .eq('campaign_id', campaign_id)
      .single();

    if (campaignError || !campaignData) {
      return c.json({ 
        status: 'error', 
        message: 'Campaign not found' 
      }, 404);
    }

    // Get campaign contacts
    const { data: contactsData, error: contactsError } = await db
      .from('call_campaign_contacts')
      .select('*')
      .eq('campaign_id', campaign_id)
      .order('created_at', { ascending: true });

    if (contactsError) {
      console.error('Get Campaign Contacts Error:', contactsError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to fetch campaign contacts', 
        error: contactsError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      campaign: campaignData,
      contacts: contactsData || []
    });

  } catch (error) {
    console.error('Get Campaign Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to fetch campaign', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * POST /campaigns/:campaign_id/start
 * Starts campaign execution
 * Returns: { status, message }
 */
export async function startCampaign(c: Context) {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const db = c.req.db;
    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(db, c.req.env);
    
    // Update campaign status
    const { error: updateError } = await db
      .from('call_campaigns')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString()
      })
      .eq('campaign_id', campaign_id);

    if (updateError) {
      console.error('Start Campaign Error:', updateError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to start campaign', 
        error: updateError.message 
      }, 500);
    }

    // Queue all campaign calls
    const queueResult = await campaignsService.queueCampaignCalls(campaign_id);
    
    if (!queueResult.success) {
      return c.json({
        status: 'error',
        message: queueResult.message,
        error: queueResult.error
      }, 500);
    }

    return c.json({
      status: 'success',
      message: `Campaign started successfully. ${queueResult.queued_count} calls queued.`
    });

  } catch (error) {
    console.error('Start Campaign Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to start campaign', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * POST /campaigns/:campaign_id/stop
 * Stops campaign execution
 * Returns: { status, message }
 */
export async function stopCampaign(c: Context) {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const db = c.req.db;
    
    // Update campaign status
    const { error: updateError } = await db
      .from('call_campaigns')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('campaign_id', campaign_id);

    if (updateError) {
      console.error('Stop Campaign Error:', updateError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to stop campaign', 
        error: updateError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      message: 'Campaign stopped successfully'
    });

  } catch (error) {
    console.error('Stop Campaign Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to stop campaign', 
      error: error instanceof Error ? error.message : error 
    }, 500);
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
    const campaign_id = c.req.param('campaign_id');
    const contact_id = c.req.param('contact_id');
    const payload = await c.req.json();
    
    if (!campaign_id || !contact_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id or contact_id' 
      }, 400);
    }

    const db = c.req.db;
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Add optional fields if provided
    if (payload.call_status) updateData.call_status = payload.call_status;
    if (payload.ultravox_call_id) updateData.ultravox_call_id = payload.ultravox_call_id;
    if (payload.call_duration) updateData.call_duration = payload.call_duration;
    if (payload.call_summary) updateData.call_summary = payload.call_summary;
    if (payload.call_notes) updateData.call_notes = payload.call_notes;
    if (payload.interest_level) updateData.interest_level = payload.interest_level;
    if (payload.error_message) updateData.error_message = payload.error_message;

    // Set timing fields based on status
    if (payload.call_status === 'queued') {
      updateData.queued_at = new Date().toISOString();
    } else if (payload.call_status === 'in_progress') {
      updateData.started_at = new Date().toISOString();
    } else if (['completed', 'failed'].includes(payload.call_status)) {
      updateData.completed_at = new Date().toISOString();
    }

    const { error: updateError } = await db
      .from('call_campaign_contacts')
      .update(updateData)
      .eq('contact_id', contact_id)
      .eq('campaign_id', campaign_id);

    if (updateError) {
      console.error('Update Contact Error:', updateError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to update contact', 
        error: updateError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      message: 'Contact updated successfully'
    });

  } catch (error) {
    console.error('Update Contact Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to update contact', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * GET /campaigns/:campaign_id/stats
 * Gets campaign statistics
 * Returns: { status, stats }
 */
export async function getCampaignStats(c: Context) {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(c.req.db, c.req.env);
    
    const stats = await campaignsService.getCampaignStats(campaign_id);

    return c.json({
      status: 'success',
      stats
    });

  } catch (error) {
    console.error('Get Campaign Stats Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to get campaign stats', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * DELETE /campaigns/:campaign_id
 * Deletes a campaign and all its contacts
 * Returns: { status, message }
 */
export async function deleteCampaign(c: Context) {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const db = c.req.db;
    
    // Delete campaign (contacts will be deleted automatically due to cascade)
    const { error: deleteError } = await db
      .from('call_campaigns')
      .delete()
      .eq('campaign_id', campaign_id);

    if (deleteError) {
      console.error('Delete Campaign Error:', deleteError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to delete campaign', 
        error: deleteError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      message: 'Campaign deleted successfully'
    });

  } catch (error) {
    console.error('Delete Campaign Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to delete campaign', 
      error: error instanceof Error ? error.message : error 
    }, 500);
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
    const campaign_id = c.req.param('campaign_id');
    const payload = await c.req.json();
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const db = c.req.db;
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Add scheduling fields if provided
    if (payload.scheduled_start_time !== undefined) updateData.scheduled_start_time = payload.scheduled_start_time;
    if (payload.timezone !== undefined) updateData.timezone = payload.timezone;
    if (payload.is_recurring !== undefined) updateData.is_recurring = payload.is_recurring;
    if (payload.auto_start !== undefined) updateData.auto_start = payload.auto_start;
    
    if (payload.is_recurring) {
      if (payload.recurring_type !== undefined) updateData.recurring_type = payload.recurring_type;
      if (payload.recurring_interval !== undefined) updateData.recurring_interval = payload.recurring_interval;
      if (payload.recurring_until !== undefined) updateData.recurring_until = payload.recurring_until;
      if (payload.max_executions !== undefined) updateData.max_executions = payload.max_executions;
    }

    const { error: updateError } = await db
      .from('call_campaigns')
      .update(updateData)
      .eq('campaign_id', campaign_id);

    if (updateError) {
      console.error('Update Campaign Schedule Error:', updateError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to update campaign schedule', 
        error: updateError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      message: 'Campaign schedule updated successfully'
    });

  } catch (error) {
    console.error('Update Campaign Schedule Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to update campaign schedule', 
      error: error instanceof Error ? error.message : error 
    }, 500);
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
    const user_id = c.req.query('user_id');
    const limit = parseInt(c.req.query('limit') || '50');
    const now = new Date().toISOString();
    
    const db = c.req.db;
    
    let query = db
      .from('call_campaigns')
      .select('*')
      .eq('auto_start', true)
      .eq('status', 'pending')
      .lte('scheduled_start_time', now)
      .order('scheduled_start_time', { ascending: true })
      .limit(limit);

    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Get Scheduled Campaigns Error:', error);
      return c.json({ 
        status: 'error', 
        message: 'Failed to fetch scheduled campaigns', 
        error: error.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      campaigns: data || []
    });

  } catch (error) {
    console.error('Get Scheduled Campaigns Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to fetch scheduled campaigns', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}

/**
 * POST /campaigns/:campaign_id/executions
 * Creates a new execution record for a recurring campaign
 * Returns: { status, execution_id }
 */
export async function createCampaignExecution(c: Context) {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({ 
        status: 'error', 
        message: 'Missing campaign_id' 
      }, 400);
    }

    const db = c.req.db;
    const execution_id = randomUUID();
    
    // Get campaign details
    const { data: campaignData, error: campaignError } = await db
      .from('call_campaigns')
      .select('*')
      .eq('campaign_id', campaign_id)
      .single();

    if (campaignError || !campaignData) {
      return c.json({ 
        status: 'error', 
        message: 'Campaign not found' 
      }, 404);
    }

    // Create execution record
    const { error: executionError } = await db
      .from('campaign_executions')
      .insert([{
        execution_id,
        campaign_id,
        scheduled_time: new Date().toISOString(),
        status: 'pending',
        total_contacts: campaignData.total_contacts
      }]);

    if (executionError) {
      console.error('Create Campaign Execution Error:', executionError);
      return c.json({ 
        status: 'error', 
        message: 'Failed to create campaign execution', 
        error: executionError.message 
      }, 500);
    }

    return c.json({
      status: 'success',
      execution_id,
      message: 'Campaign execution created successfully'
    });

  } catch (error) {
    console.error('Create Campaign Execution Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to create campaign execution', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
}