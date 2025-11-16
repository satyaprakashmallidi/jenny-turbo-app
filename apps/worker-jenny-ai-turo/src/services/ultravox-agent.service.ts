import axios from 'axios';
import { SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import {
  CreateUltravoxAgentRequest,
  CreateUltravoxAgentResponse,
  UpdateUltravoxAgentRequest,
  UpdateUltravoxAgentResponse,
  UltravoxAgent,
  ListAgentsResponse,
  CreateAgentCallRequest,
  CreateAgentCallResponse,
  UltravoxAgentCallTemplate,
} from '../types/ultravox-agent';

export class UltravoxAgentService {
  private static instance: UltravoxAgentService;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly env: Env;
  private readonly db: SupabaseClient;

  private constructor(env: Env, db: SupabaseClient) {
    this.env = env;
    this.db = db;
    this.apiKey = env.ULTRAVOX_API_KEY;
    this.baseUrl = env.ULTRAVOX_API_URL || 'https://api.ultravox.ai/api';
  }

  public static getInstance(env: Env, db: SupabaseClient): UltravoxAgentService {
    if (!UltravoxAgentService.instance) {
      UltravoxAgentService.instance = new UltravoxAgentService(env, db);
    }
    return UltravoxAgentService.instance;
  }

  /**
   * Create a new Ultravox Agent
   */
  async createAgent(request: CreateUltravoxAgentRequest): Promise<CreateUltravoxAgentResponse> {
    try {
      console.log('[UltravoxAgentService] Creating agent:', request.name);

      const response = await axios.post<CreateUltravoxAgentResponse>(
        `${this.baseUrl}/agents`,
        request,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[UltravoxAgentService] Agent created successfully:', response.data.agentId);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[UltravoxAgentService] Create agent error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });

        if (error.response?.status === 409) {
          throw new Error(`An agent with name "${request.name}" already exists. Please try a different name.`);
        }

        throw new Error(`Failed to create agent: ${error.response?.data?.message || error.message}`);
      }

      throw new Error(`Failed to create agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get an agent by ID
   */
  async getAgent(agentId: string): Promise<UltravoxAgent> {
    try {
      console.log('[UltravoxAgentService] Fetching agent:', agentId);

      const response = await axios.get<UltravoxAgent>(
        `${this.baseUrl}/agents/${agentId}`,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[UltravoxAgentService] Get agent error:', {
          status: error.response?.status,
          data: error.response?.data,
        });

        if (error.response?.status === 404) {
          throw new Error(`Agent not found: ${agentId}`);
        }

        throw new Error(`Failed to get agent: ${error.response?.data?.message || error.message}`);
      }

      throw new Error(`Failed to get agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update an existing agent
   */
  async updateAgent(agentId: string, request: UpdateUltravoxAgentRequest): Promise<UpdateUltravoxAgentResponse> {
    try {
      console.log('[UltravoxAgentService] Updating agent:', agentId);

      const response = await axios.patch<UpdateUltravoxAgentResponse>(
        `${this.baseUrl}/agents/${agentId}`,
        request,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[UltravoxAgentService] Agent updated successfully:', agentId);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[UltravoxAgentService] Update agent error:', {
          status: error.response?.status,
          data: error.response?.data,
        });

        if (error.response?.status === 404) {
          throw new Error(`Agent not found: ${agentId}`);
        }

        throw new Error(`Failed to update agent: ${error.response?.data?.message || error.message}`);
      }

      throw new Error(`Failed to update agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    try {
      console.log('[UltravoxAgentService] Deleting agent:', agentId);

      await axios.delete(
        `${this.baseUrl}/agents/${agentId}`,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[UltravoxAgentService] Agent deleted successfully:', agentId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[UltravoxAgentService] Delete agent error:', {
          status: error.response?.status,
          data: error.response?.data,
        });

        if (error.response?.status === 404) {
          console.warn('[UltravoxAgentService] Agent not found (already deleted?):', agentId);
          // Don't throw error if already deleted
          return;
        }

        throw new Error(`Failed to delete agent: ${error.response?.data?.message || error.message}`);
      }

      throw new Error(`Failed to delete agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all agents (paginated)
   */
  async listAgents(params?: { cursor?: string; limit?: number; search?: string }): Promise<ListAgentsResponse> {
    try {
      console.log('[UltravoxAgentService] Listing agents');

      const queryParams = new URLSearchParams();
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);

      const response = await axios.get<ListAgentsResponse>(
        `${this.baseUrl}/agents${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[UltravoxAgentService] List agents error:', {
          status: error.response?.status,
          data: error.response?.data,
        });

        throw new Error(`Failed to list agents: ${error.response?.data?.message || error.message}`);
      }

      throw new Error(`Failed to list agents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a call using an agent
   */
  async createCallWithAgent(agentId: string, request: CreateAgentCallRequest): Promise<CreateAgentCallResponse> {
    try {
      console.log('[UltravoxAgentService] Creating call with agent:', agentId);

      const response = await axios.post<CreateAgentCallResponse>(
        `${this.baseUrl}/agents/${agentId}/calls`,
        request,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[UltravoxAgentService] Call created successfully:', response.data.callId);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[UltravoxAgentService] Create call error:', {
          status: error.response?.status,
          data: error.response?.data,
        });

        if (error.response?.status === 404) {
          throw new Error(`Agent not found: ${agentId}`);
        }

        throw new Error(`Failed to create call: ${error.response?.data?.message || error.message}`);
      }

      throw new Error(`Failed to create call: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sanitize agent name to match Ultravox requirements: ^[a-zA-Z0-9_-]{1,64}$
   */
  private sanitizeAgentName(name: string): string {
    // Replace spaces and invalid characters with underscores
    let sanitized = name
      .replace(/\s+/g, '_')           // Replace spaces with underscores
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove invalid characters
      .substring(0, 64);               // Max 64 characters

    // Ensure we have at least one character
    if (!sanitized || sanitized.length === 0) {
      sanitized = 'agent_' + Date.now();
    }

    return sanitized;
  }

  /**
   * Map bot data to Ultravox Agent request format
   */
  mapBotToAgentRequest(bot: {
    name: string;
    system_prompt: string;
    voice: string;
    model: string;
    temperature: number;
    selected_tools?: string[];
    first_speaker: "FIRST_SPEAKER_AGENT" | "FIRST_SPEAKER_USER";
  }): CreateUltravoxAgentRequest {
    const callTemplate: UltravoxAgentCallTemplate = {
      systemPrompt: bot.system_prompt,
      voice: bot.voice,
      model: bot.model,
      temperature: bot.temperature > 0 ? Number(`0.${bot.temperature}`) : 0,
      recordingEnabled: true,
      medium: {
        twilio: {},
      },
      selectedTools: [],
    };

    // Sanitize the agent name to match Ultravox requirements
    const sanitizedName = this.sanitizeAgentName(bot.name);

    return {
      name: sanitizedName,
      callTemplate,
    };
  }
}
