import { CreateToolRequest, CreateToolResponse, GetToolResponse, ListToolsResponse } from '../types/tool.types';
import { Env } from '../config/env';
import { SupabaseClient } from '@supabase/supabase-js';

const ULTRAVOX_TOOL_URL = 'https://api.ultravox.ai/api/tools';

export class ToolService {
  private static instance: ToolService;
  private env: Env;
  private db: SupabaseClient;

  private constructor(env: Env, db: SupabaseClient) {
    this.env = env;
    this.db = db;
  }

  public static getInstance(env: Env, db: SupabaseClient): ToolService {
    if (!ToolService.instance) {
      ToolService.instance = new ToolService(env, db);
    }
    return ToolService.instance;
  }

  async createTool(request: CreateToolRequest, userId: string): Promise<CreateToolResponse> {
    try {
      // Validate and set default timeout
      if (!request.definition.timeout) {
        request.definition.timeout = '20s';
      } else {
        const timeoutValue = parseInt(request.definition.timeout.replace(/[^0-9]/g, ''));
        const timeoutUnit = request.definition.timeout.replace(/[0-9]/g, '').toLowerCase();
        
        let timeoutSeconds = timeoutValue;
        if (timeoutUnit.includes('m')) {
          timeoutSeconds = timeoutValue * 60;
        }
        
        if (timeoutSeconds > 20) {
          request.definition.timeout = '20s';
        }
      }

      // Create a properly formatted request body according to API schema
      const requestBody = {
        name: request.name,
        definition: {
          modelToolName: request.definition.modelToolName,
          description: request.definition.description,
          automaticParameters: request.definition.automaticParameters,
          dynamicParameters: request.definition.dynamicParameters,
          staticParameters: request.definition.staticParameters,
          http: {
            baseUrlPattern: request?.definition?.http?.baseUrlPattern,
            httpMethod: request?.definition?.http?.httpMethod
          },
          timeout: request.definition.timeout,
          precomputable: request.definition.precomputable || false
        }
      };

      // Log the request for debugging
      console.log('Request body:', JSON.stringify(requestBody, null, 2));

      // Create tool in Ultravox
      const response = await fetch(`${ULTRAVOX_TOOL_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.env.ULTRAVOX_API_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Failed to create tool: ${errorText}`);
      }

      const ultravoxTool = await response.json() as CreateToolResponse;

      // Store in Supabase
      const { data: storedTool, error } = await this.db
        .from('tools')
        .insert({
          user_id: userId,
          tool_id: ultravoxTool.toolId,
          name: request.name,
          model_tool_name: request.definition.modelToolName,
          description: request.definition.description,
          definition: request.definition,
        })
        .select()
        .single();

      if (error) {
        console.error('Error storing tool in database:', error);
        throw new Error('Failed to store tool in database');
      }

      return ultravoxTool;
    } catch (error) {
      console.error('Error in createTool:', error);
      throw error;
    }
  }

  async updateTool(toolId: string, userId: string, request: Partial<CreateToolRequest>): Promise<void> {
    try {
      // First update in Ultravox
      const response = await fetch(`${ULTRAVOX_TOOL_URL}/${toolId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.env.ULTRAVOX_API_KEY,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update tool in Ultravox: ${errorText}`);
      }

      // Then update in Supabase
      const updateData: any = {};
      if (request.name) updateData.name = request.name;
      if (request.definition?.modelToolName) updateData.model_tool_name = request.definition.modelToolName;
      if (request.definition?.description) updateData.description = request.definition.description;
      if (request.definition) updateData.definition = request.definition;

      const { error } = await this.db
        .from('tools')
        .update(updateData)
        .eq('tool_id', toolId)
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        console.error('Error updating tool in database:', error);
        throw new Error('Failed to update tool in database');
      }
    } catch (error) {
      console.error('Error in updateTool:', error);
      throw error;
    }
  }

  async getUserTools(userId: string): Promise<ListToolsResponse> {
    try {
      // First get tool IDs from Supabase
      const { data: userTools, error } = await this.db
        .from('tools')
        .select('tool_id')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        console.error('Error fetching user tools from database:', error);
        throw new Error('Failed to fetch user tools from database');
      }

      if (!userTools || userTools.length === 0) {
        return {
          results: [],
          total: 0
        };
      }

      // Then fetch complete tool information from Ultravox
      const response = await fetch(`${ULTRAVOX_TOOL_URL}`, {
        headers: {
          'X-API-Key': this.env.ULTRAVOX_API_KEY,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch tools from Ultravox: ${errorText}`);
      }

      const ultravoxTools = await response.json() as ListToolsResponse;

      // Filter tools to only include those owned by the user
      const userToolIds = new Set(userTools.map(t => t.tool_id));

      const results = ultravoxTools.results.filter(tool => userToolIds.has(tool.toolId));
      return {
        ...ultravoxTools,
        total: results.length,
        results: results
      };
    } catch (error) {
      console.error('Error in getUserTools:', error);
      throw error;
    }
  }

  async getTool(toolId: string, userId: string): Promise<GetToolResponse> {
    try {
      // First verify the user owns this tool
      const { data: tool, error } = await this.db
        .from('tools')
        .select('tool_id')
        .eq('tool_id', toolId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      if (error || !tool) {
        throw new Error('Tool not found or user does not have access');
      }

      // Then fetch complete tool information from Ultravox
      const response = await fetch(`${ULTRAVOX_TOOL_URL}/${toolId}`, {
        headers: {
          'X-API-Key': this.env.ULTRAVOX_API_KEY,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch tool from Ultravox: ${errorText}`);
      }

      return await response.json() as GetToolResponse;
    } catch (error) {
      console.error('Error in getTool:', error);
      throw error;
    }
  }

  async deactivateTool(toolId: string, userId: string) {
    try {
      const { error } = await this.db
        .from('tools')
        .update({ is_active: false })
        .eq('tool_id', toolId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deactivating tool:', error);
        throw new Error('Failed to deactivate tool');
      }
    } catch (error) {
      console.error('Error in deactivateTool:', error);
      throw error;
    }
  }

  async deleteTool(toolId: string, userId: string) {
    try {
      // First delete from Ultravox
      const response = await fetch(`${ULTRAVOX_TOOL_URL}/${toolId}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': this.env.ULTRAVOX_API_KEY,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete tool from Ultravox: ${errorText}`);
      }

      // Then delete from Supabase
      const { error } = await this.db
        .from('tools')
        .delete()
        .eq('tool_id', toolId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting tool from database:', error);
        throw new Error('Failed to delete tool from database');
      }
    } catch (error) {
      console.error('Error in deleteTool:', error);
      throw error;
    }
  }
}
