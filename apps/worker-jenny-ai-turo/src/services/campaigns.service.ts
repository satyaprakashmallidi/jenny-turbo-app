import { randomUUID } from "crypto";
import { TwilioService } from "./twilio.service";

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
   * Queue all contacts in a campaign for calling
   */
  async queueCampaignCalls(campaign_id: string): Promise<{ success: boolean; message: string; queued_count?: number; error?: string }> {
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

      if (contactsError) {
        return { success: false, message: 'Failed to fetch contacts', error: contactsError.message };
      }

      if (!contactsData || contactsData.length === 0) {
        return { success: false, message: 'No pending contacts found' };
      }

      // Queue calls for each contact
      let queuedCount = 0;
      for (const contact of contactsData) {
        try {
          const job_id = randomUUID();
          
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
            console.error('Failed to create job for contact:', contact.contact_id, jobError);
            continue;
          }

          // Update contact status to queued
          await this.db
            .from('call_campaign_contacts')
            .update({
              call_status: 'queued',
              job_id,
              queued_at: new Date().toISOString()
            })
            .eq('contact_id', contact.contact_id);

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
                campaign_settings: campaignData.campaign_settings
              }
            });
          }

          queuedCount++;
        } catch (error) {
          console.error('Error queueing contact:', contact.contact_id, error);
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
  async scheduleNextExecution(campaign_id: string): Promise<{ success: boolean; message: string; next_execution?: string }> {
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
   * Process scheduled campaigns (to be called by a cron job or scheduled task)
   */
  async processScheduledCampaigns(): Promise<{ success: boolean; processed_count: number; errors: any[] }> {
    try {
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