import { Context } from 'hono';
import { getEnv } from '../config/env';
import { getSupabaseClient } from '../lib/supabase/client';
import { WebhooksService } from '../services/webhooks.service';
import { CreateWebhookRequest, UpdateWebhookRequest } from '../types/webhooks';

export const listWebhooks = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const agentId = c.req.query('agent_id');

    const webhooksService = WebhooksService.getInstance();
    webhooksService.setDependencies(supabase, env);

    // Only get webhooks from our database (created through UI)
    const webhooks = await webhooksService.getUserCreatedWebhooks(agentId);

    return c.json({
      status: 'success',
      data: {
        results: webhooks,
        next: null,
        previous: null
      },
    });
  } catch (error) {
    console.error('Error listing webhooks:', error);
    return c.json({
      status: 'error',
      message: 'Failed to list webhooks',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

export const getWebhook = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const webhookId = c.req.param('webhook_id');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter',
      }, 400);
    }

    if (!webhookId) {
      return c.json({
        status: 'error',
        message: 'Missing webhook_id parameter',
      }, 400);
    }

    const webhooksService = WebhooksService.getInstance();
    webhooksService.setDependencies(supabase, env);

    const webhook = await webhooksService.getWebhook(webhookId, userId);

    return c.json({
      status: 'success',
      data: webhook,
    });
  } catch (error) {
    console.error('Error getting webhook:', error);
    return c.json({
      status: 'error',
      message: 'Failed to get webhook',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

export const createWebhook = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const body = await c.req.json() as CreateWebhookRequest & { user_id: string };
    const { user_id, ...webhookData } = body;

    if (!user_id) {
      return c.json({
        status: 'error',
        message: 'Missing user_id',
      }, 400);
    }

    if (!webhookData.url || !webhookData.events || webhookData.events.length === 0) {
      return c.json({
        status: 'error',
        message: 'Missing required fields: url and events are required',
      }, 400);
    }

    // Validate URL
    try {
      new URL(webhookData.url);
    } catch {
      return c.json({
        status: 'error',
        message: 'Invalid URL format',
      }, 400);
    }

    // Validate events
    const validEvents = ['call.started', 'call.joined', 'call.ended'];
    const invalidEvents = webhookData.events.filter(event => !validEvents.includes(event));
    if (invalidEvents.length > 0) {
      return c.json({
        status: 'error',
        message: `Invalid events: ${invalidEvents.join(', ')}. Valid events are: ${validEvents.join(', ')}`,
      }, 400);
    }

    const webhooksService = WebhooksService.getInstance();
    webhooksService.setDependencies(supabase, env);

    const webhook = await webhooksService.createWebhook(webhookData, user_id);

    return c.json({
      status: 'success',
      data: webhook,
    });
  } catch (error) {
    console.error('Error creating webhook:', error);
    return c.json({
      status: 'error',
      message: 'Failed to create webhook',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

export const updateWebhook = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const webhookId = c.req.param('webhook_id');
    const body = await c.req.json() as UpdateWebhookRequest & { user_id: string };
    const { user_id, ...webhookData } = body;

    if (!user_id) {
      return c.json({
        status: 'error',
        message: 'Missing user_id',
      }, 400);
    }

    if (!webhookId) {
      return c.json({
        status: 'error',
        message: 'Missing webhook_id parameter',
      }, 400);
    }

    // Validate URL if provided
    if (webhookData.url) {
      try {
        new URL(webhookData.url);
      } catch {
        return c.json({
          status: 'error',
          message: 'Invalid URL format',
        }, 400);
      }
    }

    // Validate events if provided
    if (webhookData.events) {
      const validEvents = ['call.started', 'call.joined', 'call.ended'];
      const invalidEvents = webhookData.events.filter(event => !validEvents.includes(event));
      if (invalidEvents.length > 0) {
        return c.json({
          status: 'error',
          message: `Invalid events: ${invalidEvents.join(', ')}. Valid events are: ${validEvents.join(', ')}`,
        }, 400);
      }
    }

    const webhooksService = WebhooksService.getInstance();
    webhooksService.setDependencies(supabase, env);

    const webhook = await webhooksService.updateWebhook(webhookId, webhookData, user_id);

    return c.json({
      status: 'success',
      data: webhook,
    });
  } catch (error) {
    console.error('Error updating webhook:', error);
    return c.json({
      status: 'error',
      message: 'Failed to update webhook',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

export const deleteWebhook = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const webhookId = c.req.param('webhook_id');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter',
      }, 400);
    }

    if (!webhookId) {
      return c.json({
        status: 'error',
        message: 'Missing webhook_id parameter',
      }, 400);
    }

    const webhooksService = WebhooksService.getInstance();
    webhooksService.setDependencies(supabase, env);

    await webhooksService.deleteWebhook(webhookId, userId);

    return c.json({
      status: 'success',
      message: 'Webhook deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    return c.json({
      status: 'error',
      message: 'Failed to delete webhook',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

export const getUserWebhooks = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter',
      }, 400);
    }

    const webhooksService = WebhooksService.getInstance();
    webhooksService.setDependencies(supabase, env);

    const webhooks = await webhooksService.getUserWebhooksFromDatabase(userId);

    return c.json({
      status: 'success',
      data: webhooks,
    });
  } catch (error) {
    console.error('Error getting user webhooks:', error);
    return c.json({
      status: 'error',
      message: 'Failed to get user webhooks',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};