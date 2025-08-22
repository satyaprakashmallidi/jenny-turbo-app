import { Hono } from 'hono';
import { 
  listWebhooks, 
  getWebhook, 
  createWebhook, 
  updateWebhook, 
  deleteWebhook,
  getUserWebhooks 
} from '../controller/webhooks.controller';
import { Env } from '../config/env';

const webhooksRoutes = new Hono<{ Bindings: Env }>();

// List all webhooks (from Ultravox API)
webhooksRoutes.get('/', listWebhooks);

// Get user webhooks from database
webhooksRoutes.get('/user', getUserWebhooks);

// Get specific webhook
webhooksRoutes.get('/:webhook_id', getWebhook);

// Create new webhook
webhooksRoutes.post('/', createWebhook);

// Update webhook
webhooksRoutes.patch('/:webhook_id', updateWebhook);

// Delete webhook
webhooksRoutes.delete('/:webhook_id', deleteWebhook);

export default webhooksRoutes;