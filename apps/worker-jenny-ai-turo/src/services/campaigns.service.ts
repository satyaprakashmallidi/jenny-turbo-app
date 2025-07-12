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
  system_prompt: string;
  voice_settings?: any;
  field_mappings?: any;
  user_id: string;
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
                system_prompt: campaignData.system_prompt,
                voice_settings: campaignData.voice_settings,
                field_mappings: campaignData.field_mappings,
                user_id: campaignData.user_id
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
              Object.entries(campaignData.field_mappings).forEach(([placeholder, fieldName]) => {
                const value = contact.contact_data[fieldName as string] || '';
                processedSystemPrompt = processedSystemPrompt.replace(
                  new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g'), 
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
                toNumber: contact.contact_phone,
                customerName: contact.contact_name || 'Customer',
                // Campaign-specific data for tracking
                campaign_id,
                contact_id: contact.contact_id
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
}