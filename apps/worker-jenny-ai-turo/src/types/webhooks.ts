export type WebhookEvent = 'call.started' | 'call.joined' | 'call.ended';

export interface UltravoxWebhook {
  webhookId: string;
  created: string;
  url: string;
  events: WebhookEvent[];
  status: 'normal' | 'unhealthy';
  lastStatusChange: string | null;
  recentFailures: WebhookFailure[];
  agentId?: string | null;
  secrets?: string[];
}

export interface WebhookFailure {
  timestamp: string;
  statusCode: number;
  error: string;
}

export interface CreateWebhookRequest {
  url: string;
  events: WebhookEvent[];
  agentId?: string | null;
  secrets?: string[];
}

export interface UpdateWebhookRequest {
  url?: string;
  events?: WebhookEvent[];
  agentId?: string | null;
  secrets?: string[];
}

export interface WebhookListResponse {
  next: string | null;
  previous: string | null;
  results: UltravoxWebhook[];
}

export interface DatabaseWebhook {
  webhook_id: string;
  user_id: string;
  ultravox_webhook_id: string | null;
  url: string;
  events: string[];
  agent_id: string | null;
  status: string;
  last_status_change: string | null;
  secret_key: string | null;
  recent_failures: any;
  created_at: string;
  updated_at: string;
}