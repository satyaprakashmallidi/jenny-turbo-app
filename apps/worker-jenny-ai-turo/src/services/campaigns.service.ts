import { randomUUID } from "crypto";
import { TwilioService } from "./twilio.service";

export interface TimeWindow {
  start_hour: number; // 0-23 (24-hour format)
  start_minute: number; // 0-59
  end_hour: number; // 0-23 (24-hour format)
  end_minute: number; // 0-59
  days_of_week?: number[]; // 0=Sunday, 1=Monday, etc. If not specified, applies to all days
}

export interface BulkCallPayload {
  campaign_id: string;
  contact_id: string;
  contact_phone: string;
  contact_name?: string;
  contact_data: any;
  bot_id: string;
  bot_name?: string;
  twilio_phone_number: string;
  twilio_phone_numbers?: string[]; // Array of available numbers
  system_prompt: string;
  voice_settings?: any;
  field_mappings?: any;
  user_id: string;
  campaign_settings?: {
    enableNumberLocking?: boolean;
    timeWindow?: TimeWindow;
    timezone?: string;
  };
}

export class CampaignsService {
  private static instance: CampaignsService;
  private db: any;
  private env: any;

  private constructor() {}

  public static getInstance(): CampaignsService {
    if (!CampaignsService.instance) {
      CampaignsService.instance = new CampaignsService();
    }
    return CampaignsService.instance;
  }

  public setDependencies(db: any, env: any) {
    this.db = db;
    this.env = env;
  }

  /**
   * Check if current time is within the allowed time window for a campaign
   */
  public isWithinTimeWindow(timeWindow: TimeWindow | undefined, timezone: string = 'UTC'): boolean {
    if (!timeWindow) {
      return true; // No time restriction
    }

    try {
      // Get current time in the specified timezone
      const now = new Date();
      const currentTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
      
      const currentHour = currentTime.getHours();
      const currentMinute = currentTime.getMinutes();
      const currentDay = currentTime.getDay(); // 0=Sunday, 1=Monday, etc.
      
      // Check day of week restriction if specified
      if (timeWindow.days_of_week && timeWindow.days_of_week.length > 0) {
        if (!timeWindow.days_of_week.includes(currentDay)) {
          console.log(`❌ Current day (${currentDay}) not in allowed days: ${timeWindow.days_of_week}`);
          return false;
        }
      }
      
      // Convert current time to minutes for easier comparison
      const currentTotalMinutes = currentHour * 60 + currentMinute;
      const startTotalMinutes = timeWindow.start_hour * 60 + timeWindow.start_minute;
      const endTotalMinutes = timeWindow.end_hour * 60 + timeWindow.end_minute;
      
      // Handle time windows that cross midnight (e.g., 10 PM to 6 AM)
      if (startTotalMinutes > endTotalMinutes) {
        // Time window crosses midnight
        return currentTotalMinutes >= startTotalMinutes || currentTotalMinutes <= endTotalMinutes;
      } else {
        // Normal time window within the same day
        return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
      }
      
    } catch (error) {
      console.error('Error checking time window:', error);
      return true; // Default to allowing calls if there's an error
    }
  }

  /**
   * Queue all contacts in a campaign for calling
   */
  async queueCampaignCalls(campaign_id: string): Promise<{ success: boolean; message: string; queued_count?: number; error?: string; completed?: boolean }> {
    try {
      // Get campaign details
      const { data: campaignData, error: campaignError } = await this.db
        .from('call_campaigns')
        .select('*')
        .eq('campaign_id', campaign_id)
        .single();

      if (campaignError || !campaignData) {
        return { success: false, message: 'Campaign not found', error: campaignError?.message };
      }

      console.log("camamamam data", campaignData);


      // Get pending contacts
      const { data: contactsData, error: contactsError } = await this.db
        .from('call_campaign_contacts')
        .select('*')
        .eq('campaign_id', campaign_id)
        .eq('call_status', 'pending');

      console.log("📋 Contacts found for queueing:", {
        campaign_id,
        total_contacts_in_campaign: campaignData.total_contacts,
        pending_contacts_found: contactsData?.length || 0,
        contact_details: contactsData?.map(c => ({
          contact_id: c.contact_id,
          contact_phone: c.contact_phone,
          contact_name: c.contact_name,
          call_status: c.call_status
        })) || []
      });

      if (contactsError) {
        return { success: false, message: 'Failed to fetch contacts', error: contactsError.message };
      }

      if (!contactsData || contactsData.length === 0) {
        console.log(`📋 No pending contacts found for campaign ${campaign_id}, checking if campaign should be completed...`);
        
        // If no pending contacts found, check if campaign should be marked as completed
        const statusCheckResult = await this.checkAndUpdateCampaignStatus(campaign_id);
        console.log(`🔍 Campaign status check result:`, statusCheckResult);
        
        if (statusCheckResult.status === 'completed') {
          console.log(`✅ Campaign ${campaign_id} has been marked as completed!`);
          return { success: true, message: 'Campaign completed - no pending contacts remaining', queued_count: 0, completed: true };
        }
        
        return { success: false, message: 'No pending contacts found' };
      }

      // Queue calls for each contact
      let queuedCount = 0;
      console.log(`🔄 Starting to process ${contactsData.length} contacts for queueing...`);
      
      for (const contact of contactsData) {
        try {
          console.log(`📞 Processing contact ${queuedCount + 1}/${contactsData.length}:`, {
            contact_id: contact.contact_id,
            contact_phone: contact.contact_phone,
            contact_name: contact.contact_name
          });
          
          const job_id = randomUUID();
          console.log(`🆔 Generated job_id: ${job_id}`);
          
          // Create call job record
          const { error: jobError } = await this.db
            .from('call_jobs')
            .insert([{
              job_id,
              campaign_id,
              contact_id: contact.contact_id,
              user_id: campaignData.user_id,
              status: 'pending',
              payload: {
                campaign_id,
                contact_id: contact.contact_id,
                contact_phone: contact.contact_phone,
                contact_name: contact.contact_name,
                contact_data: contact.contact_data,
                bot_id: campaignData.bot_id,
                bot_name: campaignData.bot_name,
                twilio_phone_number: campaignData.twilio_phone_number,
                twilio_phone_numbers: campaignData.twilio_phone_numbers, // Include array of numbers
                system_prompt: campaignData.system_prompt,
                voice_settings: campaignData.voice_settings,
                field_mappings: campaignData.field_mappings,
                user_id: campaignData.user_id,
                campaign_settings: campaignData.campaign_settings || {}
              }
            }]);

           

          if (jobError) {
            console.error('❌ Failed to create job for contact:', contact.contact_id, jobError);
            continue;
          }
          console.log(`✅ Successfully created job record for contact: ${contact.contact_id}`);

          // Update contact status to queued
          const { error: updateError } = await this.db
            .from('call_campaign_contacts')
            .update({
              call_status: 'queued',
              job_id,
              queued_at: new Date().toISOString()
            })
            .eq('contact_id', contact.contact_id);

          if (updateError) {
            console.error('❌ Failed to update contact status to queued:', contact.contact_id, updateError);
            continue;
          }
          console.log(`✅ Updated contact status to 'queued' for: ${contact.contact_id}`);

          // Queue the job (if queue is available)
          if (this.env.calls_que) {
            // Process system prompt with field mappings
            let processedSystemPrompt = campaignData.system_prompt;
            if (campaignData.field_mappings && contact.contact_data) {
              // console.log('Original system prompt:', campaignData.system_prompt);
              // console.log('Field mappings:', campaignData.field_mappings);
              // console.log('Contact data:', contact.contact_data);
              
              Object.entries(campaignData.field_mappings).forEach(([placeholder, fieldName]) => {
                const value = contact.contact_data[fieldName as string] || '';
                const pattern = `\\<\\<\\<${placeholder}\\>\\>\\>`;
                // console.log(`Replacing <<<${placeholder}>>> with: "${value}"`);
                processedSystemPrompt = processedSystemPrompt.replace(
                  new RegExp(pattern, 'g'), 
                  value
                );
              });
              
            }

            // Create call configuration matching the expected format
            const callConfig = {
              voice: campaignData.voice_settings?.voice || "d17917ec-fd98-4c50-8c83-052c575cbf3e",
              temperature: campaignData.voice_settings?.temperature || 0.6,
              joinTimeout: "30s",
              maxDuration: "300s",
              recordingEnabled: true,
              timeExceededMessage: "I'm sorry, I can't help you with that.",
              systemPrompt: processedSystemPrompt,
              medium: {
                twilio: {}
              },
              metadata: {
                bot_id: campaignData.bot_id,
                user_id: campaignData.user_id,
                campaign_id,
                contact_id: contact.contact_id,
                job_id
              },
              selectedTools: [
                { toolName: "hangUp" },
                { toolName: "leaveVoicemail" }
              ]
            };

            await this.env.calls_que.send({
              job_id,
              payload: {
                callConfig,
                botId: campaignData.bot_id,
                userId: campaignData.user_id,
                tools: callConfig.selectedTools,
                twilioFromNumber: campaignData.twilio_phone_number,
                twilio_phone_numbers: campaignData.twilio_phone_numbers, // Add array of numbers
                toNumber: contact.contact_phone,
                customerName: contact.contact_name || 'Customer',
                // Campaign-specific data for tracking
                campaign_id,
                contact_id: contact.contact_id,
                campaign_settings: {
                  ...campaignData.campaign_settings,
                  // Enable number locking by default for campaigns with multiple numbers
                  enableNumberLocking: campaignData.twilio_phone_numbers?.length > 1 ? true : (campaignData.campaign_settings?.enableNumberLocking || false)
                }
              }
            });
            console.log(`🚀 Successfully sent job to queue: ${job_id} for contact: ${contact.contact_phone}`);
          } else {
            console.error('❌ Queue not available (calls_que is null)');
          }

          queuedCount++;
          console.log(`✅ Contact ${queuedCount}/${contactsData.length} completed successfully`);
        } catch (error) {
          console.error('❌ Error queueing contact:', contact.contact_id, error);
        }
      }

      return { 
        success: true, 
        message: `Successfully queued ${queuedCount} calls`, 
        queued_count: queuedCount 
      };

    } catch (error) {
      console.error('Queue Campaign Calls Error:', error);
      return { 
        success: false, 
        message: 'Failed to queue campaign calls', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Process a single call from the campaign queue (now handled by the main queue processor)
   * This method is kept for compatibility but actual processing happens in the queue
   */
  async processCampaignCall(payload: BulkCallPayload): Promise<{ success: boolean; call_id?: string; error?: string }> {
    // This is now handled by the main queue processor in index.ts
    // The queue processor will:
    // 1. Update contact status to in_progress
    // 2. Process field mappings in system prompt
    // 3. Make the call via TwilioService
    // 4. Update contact with call ID
    // 5. Handle errors and update status accordingly
    
    console.log('processCampaignCall called - actual processing handled by queue processor');
    return { success: true, call_id: 'handled_by_queue' };
  }

  /**
   * Get campaign statistics
   */
  async getCampaignStats(campaign_id: string): Promise<any> {
    try {
      const { data, error } = await this.db
        .from('call_campaign_contacts')
        .select('call_status')
        .eq('campaign_id', campaign_id);

      if (error) {
        throw error;
      }

      const stats = {
        total: data.length,
        pending: 0,
        queued: 0,
        in_progress: 0,
        completed: 0,
        failed: 0
      };

      data.forEach((contact: any) => {
        stats[contact.call_status as keyof typeof stats]++;
      });

      return stats;
    } catch (error) {
      console.error('Get Campaign Stats Error:', error);
      throw error;
    }
  }

  /**
   * Cancel all pending calls in a campaign
   */
  async cancelCampaignCalls(campaign_id: string): Promise<{ success: boolean; message: string; cancelled_count?: number }> {
    try {
      // Update pending and queued contacts to cancelled
      const { data, error } = await this.db
        .from('call_campaign_contacts')
        .update({
          call_status: 'cancelled',
          completed_at: new Date().toISOString()
        })
        .eq('campaign_id', campaign_id)
        .in('call_status', ['pending', 'queued'])
        .select();

      if (error) {
        return { success: false, message: 'Failed to cancel calls', error: error.message };
      }

      const cancelledCount = data?.length || 0;

      return { 
        success: true, 
        message: `Successfully cancelled ${cancelledCount} calls`, 
        cancelled_count: cancelledCount 
      };

    } catch (error) {
      console.error('Cancel Campaign Calls Error:', error);
      return { 
        success: false, 
        message: 'Failed to cancel campaign calls', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Get campaigns that are scheduled to run now
   */
  async getScheduledCampaigns(limit: number = 50): Promise<any[]> {
    try {
      const now = new Date().toISOString();
      
      const { data, error } = await this.db
        .from('call_campaigns')
        .select('*')
        .eq('auto_start', true)
        .eq('status', 'pending')
        .lte('scheduled_start_time', now)
        .order('scheduled_start_time', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Get Scheduled Campaigns Error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Get Scheduled Campaigns Error:', error);
      return [];
    }
  }

  /**
   * Clean up stale "in_progress" calls that never received webhook updates
   * Calls that are older than 10 minutes and still "in_progress" will be marked as failed
   */
  async cleanupStaleInProgressCalls(): Promise<void> {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      console.log("🧹 Cleaning up stale in_progress calls older than 10 minutes...");
      
      const { data: staleCalls, error: selectError } = await this.db
        .from('call_campaign_contacts')
        .select('contact_id, campaign_id, contact_phone, created_at')
        .eq('call_status', 'in_progress')
        .lt('created_at', tenMinutesAgo);
      
      if (selectError) {
        console.error('Error selecting stale calls:', selectError);
        return;
      }
      
      if (staleCalls && staleCalls.length > 0) {
        console.log(`Found ${staleCalls.length} stale calls to clean up`);
        
        // Mark all stale calls as failed
        const { error: updateError } = await this.db
          .from('call_campaign_contacts')
          .update({
            call_status: 'failed',
            completed_at: new Date().toISOString(),
            call_notes: 'Call timed out - no webhook received',
            updated_at: new Date().toISOString()
          })
          .eq('call_status', 'in_progress')
          .lt('created_at', tenMinutesAgo);
        
        if (updateError) {
          console.error('Error updating stale calls:', updateError);
        } else {
          console.log(`✅ Successfully marked ${staleCalls.length} stale calls as failed`);
          
          // Check campaign status for affected campaigns
          const uniqueCampaignIds = [...new Set(staleCalls.map((call: any) => call.campaign_id))];
          for (const campaignId of uniqueCampaignIds) {
            console.log(`🔍 Checking campaign status after cleanup: ${campaignId}`);
            await this.checkAndUpdateCampaignStatus(campaignId as string);
          }
        }
      } else {
        console.log("No stale calls found");
      }
    } catch (error) {
      console.error('Error cleaning up stale calls:', error);
    }
  }

  /**
   * Calculate next execution time for recurring campaigns
   */
  calculateNextExecution(campaign: any): Date | null {
    if (!campaign.is_recurring || !campaign.scheduled_start_time) {
      return null;
    }

    const lastExecution = new Date(campaign.scheduled_start_time);
    const interval = campaign.recurring_interval || 1;
    let nextExecution: Date;

    switch (campaign.recurring_type) {
      case 'daily':
        nextExecution = new Date(lastExecution.getTime() + (interval * 24 * 60 * 60 * 1000));
        break;
      case 'weekly':
        nextExecution = new Date(lastExecution.getTime() + (interval * 7 * 24 * 60 * 60 * 1000));
        break;
      case 'monthly':
        nextExecution = new Date(lastExecution);
        nextExecution.setMonth(nextExecution.getMonth() + interval);
        break;
      default:
        return null;
    }

    // Check if we've reached the end date or max executions
    if (campaign.recurring_until && nextExecution > new Date(campaign.recurring_until)) {
      return null;
    }

    if (campaign.max_executions && campaign.execution_count >= campaign.max_executions) {
      return null;
    }

    return nextExecution;
  }

  /**
   * Schedule next execution for recurring campaigns
   */
  async scheduleNextExecution(campaign_id: string): Promise<{ success: boolean; message: string; next_execution?: string; error?: string }> {
    try {
      // Get campaign details
      const { data: campaignData, error: campaignError } = await this.db
        .from('call_campaigns')
        .select('*')
        .eq('campaign_id', campaign_id)
        .single();

      if (campaignError || !campaignData) {
        return { success: false, message: 'Campaign not found' };
      }

      if (!campaignData.is_recurring) {
        return { success: false, message: 'Campaign is not recurring' };
      }

      const nextExecution = this.calculateNextExecution(campaignData);
      
      if (!nextExecution) {
        // Mark campaign as completed if no more executions
        await this.db
          .from('call_campaigns')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('campaign_id', campaign_id);

        return { success: true, message: 'Campaign completed - no more executions scheduled' };
      }

      // Update campaign with next execution time and increment execution count
      const { error: updateError } = await this.db
        .from('call_campaigns')
        .update({
          scheduled_start_time: nextExecution.toISOString(),
          execution_count: (campaignData.execution_count || 0) + 1,
          status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('campaign_id', campaign_id);

      if (updateError) {
        return { success: false, message: 'Failed to schedule next execution', error: updateError.message };
      }

      return { 
        success: true, 
        message: 'Next execution scheduled successfully',
        next_execution: nextExecution.toISOString()
      };

    } catch (error) {
      console.error('Schedule Next Execution Error:', error);
      return { 
        success: false, 
        message: 'Failed to schedule next execution', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Check if all contacts in a campaign are completed and update campaign status accordingly
   */
  async checkAndUpdateCampaignStatus(campaign_id: string): Promise<{ success: boolean; message: string; status?: string; error?: string }> {
    try {
      console.log(`🔍 Checking campaign status for: ${campaign_id}`);
      
      // Get campaign details
      const { data: campaignData, error: campaignError } = await this.db
        .from('call_campaigns')
        .select('*')
        .eq('campaign_id', campaign_id)
        .single();

      if (campaignError || !campaignData) {
        console.error('Campaign not found:', campaignError);
        return { success: false, message: 'Campaign not found' };
      }

      // Skip if campaign is already completed or cancelled
      if (campaignData.status === 'completed' || campaignData.status === 'cancelled') {
        console.log(`Campaign ${campaign_id} is already ${campaignData.status}`);
        return { success: true, message: `Campaign is already ${campaignData.status}`, status: campaignData.status };
      }

      // Get all contact statuses for this campaign
      const { data: contactsData, error: contactsError } = await this.db
        .from('call_campaign_contacts')
        .select('call_status')
        .eq('campaign_id', campaign_id);

      if (contactsError) {
        console.error('Error fetching contacts:', contactsError);
        return { success: false, message: 'Failed to fetch contact statuses' };
      }

      if (!contactsData || contactsData.length === 0) {
        console.log('No contacts found for campaign');
        return { success: false, message: 'No contacts found for campaign' };
      }

      // Count contact statuses
      const statusCounts = {
        pending: 0,
        queued: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        cancelled: 0
      };

      contactsData.forEach((contact: any) => {
        const status = contact.call_status as keyof typeof statusCounts;
        if (status in statusCounts) {
          statusCounts[status]++;
        }
      });

      console.log(`📊 Campaign ${campaign_id} contact status breakdown:`, statusCounts);

      // Determine if campaign should be marked as completed
      const totalContacts = contactsData.length;
      const finishedContacts = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;
      const allContactsFinished = finishedContacts === totalContacts;

      if (allContactsFinished) {
        console.log(`✅ All contacts finished for campaign ${campaign_id}. Marking campaign as completed.`);
        
        // Calculate completion stats
        const completionRate = statusCounts.completed / totalContacts;
        const failureRate = statusCounts.failed / totalContacts;
        
        // Update campaign status to completed
        const { error: updateError } = await this.db
          .from('call_campaigns')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_contacts: statusCounts.completed,
            failed_contacts: statusCounts.failed,
            cancelled_contacts: statusCounts.cancelled,
            completion_rate: completionRate,
            failure_rate: failureRate,
            updated_at: new Date().toISOString()
          })
          .eq('campaign_id', campaign_id);

        if (updateError) {
          console.error('Error updating campaign status:', updateError);
          return { success: false, message: 'Failed to update campaign status' };
        }

        // If this is a recurring campaign, schedule the next execution
        if (campaignData.is_recurring) {
          console.log(`🔄 Campaign is recurring, scheduling next execution...`);
          const nextExecResult = await this.scheduleNextExecution(campaign_id);
          console.log('Next execution scheduling result:', nextExecResult);
        }

        return { 
          success: true, 
          message: 'Campaign marked as completed',
          status: 'completed'
        };
      } else {
        console.log(`⏳ Campaign ${campaign_id} still in progress. ${finishedContacts}/${totalContacts} contacts finished.`);
        
        // Update campaign with current progress stats
        const { error: updateError } = await this.db
          .from('call_campaigns')
          .update({
            completed_contacts: statusCounts.completed,
            failed_contacts: statusCounts.failed,
            cancelled_contacts: statusCounts.cancelled,
            in_progress_contacts: statusCounts.in_progress,
            queued_contacts: statusCounts.queued,
            pending_contacts: statusCounts.pending,
            updated_at: new Date().toISOString()
          })
          .eq('campaign_id', campaign_id);

        if (updateError) {
          console.error('Error updating campaign progress:', updateError);
        }

        return { 
          success: true, 
          message: `Campaign still in progress: ${finishedContacts}/${totalContacts} contacts completed`,
          status: 'in_progress'
        };
      }

    } catch (error) {
      console.error('Check and Update Campaign Status Error:', error);
      return { 
        success: false, 
        message: 'Failed to check campaign status', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Process scheduled campaigns (to be called by a cron job or scheduled task)
   */
  async processScheduledCampaigns(): Promise<{ success: boolean; processed_count: number; errors: any[] }> {
    try {
      // First, clean up any stale "in_progress" calls
      await this.cleanupStaleInProgressCalls();
      
      const scheduledCampaigns = await this.getScheduledCampaigns(10); // Process up to 10 campaigns at a time
      const errors: any[] = [];
      let processedCount = 0;

      for (const campaign of scheduledCampaigns) {
        try {
          // Create execution record for recurring campaigns
          if (campaign.is_recurring) {
            const execution_id = randomUUID();
            await this.db
              .from('campaign_executions')
              .insert([{
                execution_id,
                campaign_id: campaign.campaign_id,
                scheduled_time: campaign.scheduled_start_time,
                status: 'in_progress',
                total_contacts: campaign.total_contacts,
                started_at: new Date().toISOString()
              }]);
          }

          // Start the campaign
          const result = await this.queueCampaignCalls(campaign.campaign_id);
          
          if (result.success) {
            // For recurring campaigns, schedule the next execution
            if (campaign.is_recurring) {
              await this.scheduleNextExecution(campaign.campaign_id);
            }
            processedCount++;
          } else {
            errors.push({
              campaign_id: campaign.campaign_id,
              error: result.error || result.message
            });
          }

        } catch (campaignError) {
          errors.push({
            campaign_id: campaign.campaign_id,
            error: campaignError instanceof Error ? campaignError.message : String(campaignError)
          });
        }
      }

      return {
        success: true,
        processed_count: processedCount,
        errors
      };

    } catch (error) {
      console.error('Process Scheduled Campaigns Error:', error);
      return {
        success: false,
        processed_count: 0,
        errors: [{ error: error instanceof Error ? error.message : String(error) }]
      };
    }
  }
}