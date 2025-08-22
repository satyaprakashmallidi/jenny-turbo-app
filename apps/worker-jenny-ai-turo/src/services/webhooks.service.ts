import { SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import { 
  UltravoxWebhook, 
  CreateWebhookRequest, 
  UpdateWebhookRequest, 
  WebhookListResponse,
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

  async listWebhooks(userId: string, agentId?: string): Promise<WebhookListResponse> {
    this.validateDependencies();

    try {
      // Build query params
      const params = new URLSearchParams();
      if (agentId) {
        params.append('agentId', agentId);
      }
      params.append('pageSize', '100'); // Get more webhooks per page

      // Call Ultravox API
      const response = await fetch(
        `${this.env!.ULTRAVOX_API_URL}/webhooks?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'X-API-Key': this.env!.ULTRAVOX_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch webhooks: ${response.statusText}`);
      }

      const data = await response.json() as WebhookListResponse;

      // Sync with database
      if (data.results && data.results.length > 0) {
        for (const webhook of data.results) {
          await this.syncWebhookToDatabase(webhook, userId);
        }
      }

      return data;
    } catch (error) {
      console.error('Error listing webhooks:', error);
      throw error;
    }
  }

  async getWebhook(webhookId: string, userId: string): Promise<UltravoxWebhook> {
    this.validateDependencies();

    try {
      // First check if it's in our database
      const { data: dbWebhook } = await this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .eq('ultravox_webhook_id', webhookId)
        .eq('user_id', userId)
        .single();

      // Call Ultravox API
      const response = await fetch(
        `${this.env!.ULTRAVOX_API_URL}/webhooks/${webhookId}`,
        {
          method: 'GET',
          headers: {
            'X-API-Key': this.env!.ULTRAVOX_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch webhook: ${response.statusText}`);
      }

      const webhook = await response.json() as UltravoxWebhook;

      // Sync with database
      await this.syncWebhookToDatabase(webhook, userId);

      return webhook;
    } catch (error) {
      console.error('Error getting webhook:', error);
      throw error;
    }
  }

  async createWebhook(request: CreateWebhookRequest, userId: string): Promise<UltravoxWebhook> {
    this.validateDependencies();

    try {
      // Generate a secret if not provided
      if (!request.secrets || request.secrets.length === 0) {
        request.secrets = [this.generateWebhookSecret()];
      }

      // Call Ultravox API
      const response = await fetch(
        `${this.env!.ULTRAVOX_API_URL}/webhooks`,
        {
          method: 'POST',
          headers: {
            'X-API-Key': this.env!.ULTRAVOX_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create webhook: ${errorText}`);
      }

      const webhook = await response.json() as UltravoxWebhook;

      // Save to database
      await this.saveWebhookToDatabase(webhook, userId, request.secrets[0]);

      return webhook;
    } catch (error) {
      console.error('Error creating webhook:', error);
      throw error;
    }
  }

  async updateWebhook(webhookId: string, request: UpdateWebhookRequest, userId: string): Promise<UltravoxWebhook> {
    this.validateDependencies();

    try {
      // Call Ultravox API
      const response = await fetch(
        `${this.env!.ULTRAVOX_API_URL}/webhooks/${webhookId}`,
        {
          method: 'PATCH',
          headers: {
            'X-API-Key': this.env!.ULTRAVOX_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update webhook: ${errorText}`);
      }

      const webhook = await response.json() as UltravoxWebhook;

      // Update in database
      await this.updateWebhookInDatabase(webhook, userId);

      return webhook;
    } catch (error) {
      console.error('Error updating webhook:', error);
      throw error;
    }
  }

  async deleteWebhook(webhookId: string, userId: string): Promise<void> {
    this.validateDependencies();

    try {
      // Call Ultravox API
      const response = await fetch(
        `${this.env!.ULTRAVOX_API_URL}/webhooks/${webhookId}`,
        {
          method: 'DELETE',
          headers: {
            'X-API-Key': this.env!.ULTRAVOX_API_KEY,
          },
        }
      );

      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to delete webhook: ${response.statusText}`);
      }

      // Delete from database
      await this.supabase!
        .from('ultravox_webhooks')
        .delete()
        .eq('ultravox_webhook_id', webhookId)
        .eq('user_id', userId);

    } catch (error) {
      console.error('Error deleting webhook:', error);
      throw error;
    }
  }

  private async syncWebhookToDatabase(webhook: UltravoxWebhook, userId: string): Promise<void> {
    try {
      const dbWebhook: Partial<DatabaseWebhook> = {
        user_id: userId,
        ultravox_webhook_id: webhook.webhookId,
        url: webhook.url,
        events: webhook.events,
        agent_id: webhook.agentId || null,
        status: webhook.status,
        last_status_change: webhook.lastStatusChange,
        recent_failures: webhook.recentFailures || [],
      };

      await this.supabase!
        .from('ultravox_webhooks')
        .upsert(dbWebhook, {
          onConflict: 'ultravox_webhook_id',
        });
    } catch (error) {
      console.error('Error syncing webhook to database:', error);
    }
  }

  private async saveWebhookToDatabase(webhook: UltravoxWebhook, userId: string, secretKey?: string): Promise<void> {
    try {
      const dbWebhook: Partial<DatabaseWebhook> = {
        user_id: userId,
        ultravox_webhook_id: webhook.webhookId,
        url: webhook.url,
        events: webhook.events,
        agent_id: webhook.agentId || null,
        status: webhook.status,
        last_status_change: webhook.lastStatusChange,
        secret_key: secretKey || null,
        recent_failures: webhook.recentFailures || [],
      };

      await this.supabase!
        .from('ultravox_webhooks')
        .insert(dbWebhook);
    } catch (error) {
      console.error('Error saving webhook to database:', error);
      throw error;
    }
  }

  private async updateWebhookInDatabase(webhook: UltravoxWebhook, userId: string): Promise<void> {
    try {
      const updates: Partial<DatabaseWebhook> = {
        url: webhook.url,
        events: webhook.events,
        agent_id: webhook.agentId || null,
        status: webhook.status,
        last_status_change: webhook.lastStatusChange,
        recent_failures: webhook.recentFailures || [],
        updated_at: new Date().toISOString(),
      };

      await this.supabase!
        .from('ultravox_webhooks')
        .update(updates)
        .eq('ultravox_webhook_id', webhook.webhookId)
        .eq('user_id', userId);
    } catch (error) {
      console.error('Error updating webhook in database:', error);
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

  async getUserCreatedWebhooks(agentId?: string): Promise<UltravoxWebhook[]> {
    this.validateDependencies();

    try {
      let query = this.supabase!
        .from('ultravox_webhooks')
        .select('*')
        .not('ultravox_webhook_id', 'is', null) // Only webhooks that have Ultravox IDs (created through UI)
        .order('created_at', { ascending: false });

      // Filter by agent if provided
      if (agentId) {
        query = query.eq('agent_id', agentId);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      // Convert database webhooks to Ultravox format
      const webhooks: UltravoxWebhook[] = (data || []).map(dbWebhook => ({
        webhookId: dbWebhook.ultravox_webhook_id!,
        created: dbWebhook.created_at,
        url: dbWebhook.url,
        events: dbWebhook.events as WebhookEvent[],
        status: dbWebhook.status as 'normal' | 'unhealthy',
        lastStatusChange: dbWebhook.last_status_change,
        recentFailures: dbWebhook.recent_failures || [],
        agentId: dbWebhook.agent_id,
        secrets: dbWebhook.secret_key ? [dbWebhook.secret_key] : undefined,
      }));

      return webhooks;
    } catch (error) {
      console.error('Error fetching user created webhooks:', error);
      throw error;
    }
  }
}