import { SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  DatabaseWebhook,
  WebhookEvent
} from '../types/webhooks';

export class WebhooksService {
  private static instance: WebhooksService;
  private supabase: SupabaseClient | null = null;
  private env: Env | null = null;

  private constructor() {}

  public static getInstance(): WebhooksService {
    if (!WebhooksService.instance) {
      WebhooksService.instance = new WebhooksService();
    }
    return WebhooksService.instance;
  }

  public setDependencies(supabase: SupabaseClient, env: Env): void {
    this.supabase = supabase;
    this.env = env;
  }

  private validateDependencies(): void {
    if (!this.supabase || !this.env) {
      throw new Error('WebhooksService dependencies not initialized. Call setDependencies first.');
    }
  }

  async listWebhooks(userId: string, agentId?: string): Promise<DatabaseWebhook[]> {
    this.validateDependencies();

    try {
      let query = this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // Filter by agent if provided
      if (agentId) {
        query = query.or(`agent_id.eq.${agentId},agent_id.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error listing webhooks:', error);
      throw error;
    }
  }

  async getWebhook(webhookId: string, userId: string): Promise<DatabaseWebhook> {
    this.validateDependencies();

    try {
      // Get webhook directly from our database
      const { data, error } = await this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .eq('webhook_id', webhookId)
        .eq('user_id', userId)
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error getting webhook:', error);
      throw error;
    }
  }

  async createWebhook(request: CreateWebhookRequest, userId: string): Promise<DatabaseWebhook> {
    this.validateDependencies();

    console.log('Creating webhook:', request);

    try {
      // Generate a secret if not provided
      if (!request.secrets || request.secrets.length === 0) {
        request.secrets = [this.generateWebhookSecret()];
      }

      // Create webhook directly in our database
      const dbWebhook: Partial<DatabaseWebhook> = {
        user_id: userId,
        ultravox_webhook_id: null, // Not using Ultravox anymore
        url: request.url,
        events: request.events,
        agent_id: request.agentId || null,
        status: 'normal',
        last_status_change: new Date().toISOString(),
        secret_key: request.secrets[0],
        recent_failures: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase!
        .from('ultravox_webhooks')
        .insert(dbWebhook)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error creating webhook:', error);
      throw error;
    }
  }

  async updateWebhook(webhookId: string, request: UpdateWebhookRequest, userId: string): Promise<DatabaseWebhook> {
    this.validateDependencies();

    try {
      // Update webhook directly in our database
      const updates: Partial<DatabaseWebhook> = {
        updated_at: new Date().toISOString()
      };

      if (request.url) updates.url = request.url;
      if (request.events) updates.events = request.events;
      if (request.agentId !== undefined) updates.agent_id = request.agentId;
      if (request.secrets && request.secrets.length > 0) updates.secret_key = request.secrets[0];

      const { data, error } = await this.supabase!
        .from('ultravox_webhooks')
        .update(updates)
        .eq('webhook_id', webhookId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error updating webhook:', error);
      throw error;
    }
  }

  async deleteWebhook(webhookId: string, userId: string): Promise<void> {
    this.validateDependencies();

    try {
      // Delete webhook directly from our database
      const { error } = await this.supabase!
        .from('ultravox_webhooks')
        .delete()
        .eq('webhook_id', webhookId)
        .eq('user_id', userId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error deleting webhook:', error);
      throw error;
    }
  }

  private generateWebhookSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let secret = 'whsec_';
    for (let i = 0; i < 32; i++) {
      secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
  }

  async getUserWebhooksFromDatabase(userId: string): Promise<DatabaseWebhook[]> {
    this.validateDependencies();

    try {
      const { data, error } = await this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching webhooks from database:', error);
      throw error;
    }
  }

  async getUserCreatedWebhooks(userId: string, agentId?: string): Promise<DatabaseWebhook[]> {
    this.validateDependencies();

    try {
      let query = this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // Filter by agent if provided
      if (agentId) {
        query = query.or(`agent_id.eq.${agentId},agent_id.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching user created webhooks:', error);
      throw error;
    }
  }

  /**
   * Get user webhooks that should be notified for a specific event
   */
  async getUserWebhooksForEvent(userId: string, event: WebhookEvent, agentId?: string): Promise<DatabaseWebhook[]> {
    this.validateDependencies();

    try {
      let query = this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'normal') // Only active webhooks
        .contains('events', [event]); // Webhooks that listen for this event

      // Filter by agent if provided
      if (agentId) {
        query = query.or(`agent_id.eq.${agentId},agent_id.is.null`); // Include specific agent or global webhooks
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error(`Error fetching user webhooks for event ${event}:`, error);
      throw error;
    }
  }

  /**
   * Send webhook notification to multiple URLs with Promise.all
   */
  async notifyWebhooks(webhooks: DatabaseWebhook[], payload: any): Promise<{ success: number; failed: number; results: any[] }> {
    if (!webhooks || webhooks.length === 0) {
      return { success: 0, failed: 0, results: [] };
    }

    console.log(`🔔 Sending webhook notifications to ${webhooks.length} webhook(s)`);

    const webhookPromises = webhooks.map(async (webhook) => {
      try {
        console.log(`📤 Sending webhook to: ${webhook.url}`);

        const headers: HeadersInit = {
          'Content-Type': 'application/json',
          'User-Agent': 'Jenny-AI/1.0 (Webhook)',
        };

        // Add signature if webhook has a secret
        if (webhook.secret_key) {
          // Simple HMAC-like signature (could be enhanced with crypto)
          const signature = `sha256=${webhook.secret_key}`;
          headers['X-Jenny-Signature'] = signature;
        }

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          // Add timeout to prevent hanging
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          console.log(`✅ Webhook sent successfully to: ${webhook.url} (${response.status})`);
          return {
            success: true,
            webhookId: webhook.webhook_id,
            url: webhook.url,
            status: response.status
          };
        } else {
          console.error(`❌ Webhook failed for: ${webhook.url} (${response.status})`);
          return {
            success: false,
            webhookId: webhook.webhook_id,
            url: webhook.url,
            status: response.status,
            error: `HTTP ${response.status}: ${response.statusText}`
          };
        }
      } catch (error) {
        console.error(`❌ Webhook error for: ${webhook.url}`, error);
        return {
          success: false,
          webhookId: webhook.webhook_id,
          url: webhook.url,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    try {
      const results = await Promise.all(webhookPromises);
      const success = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log(`🔔 Webhook notifications completed: ${success} success, ${failed} failed`);

      return { success, failed, results };
    } catch (error) {
      console.error('❌ Error in webhook notification Promise.all:', error);
      return { success: 0, failed: webhooks.length, results: [] };
    }
  }
}