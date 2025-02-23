import { Context } from "hono";
import { getEnv } from "../config/env";
import { ToolService } from "../services/tool.service";
import { CreateToolRequest} from "../types/tool.types";

export const createTool = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const body = await c.req.json() as CreateToolRequest;
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }
    
    // Validate tool name length
    if (!body.name || body.name.length > 40) {
      return c.json(
        { error: "Tool name is required and must not exceed 40 characters" },
        { status: 400 }
      );
    }

    // Validate modelToolName format
    if (body.definition?.modelToolName && !/^[a-zA-Z0-9_-]{1,64}$/.test(body.definition.modelToolName)) {
      return c.json(
        { error: "modelToolName must match pattern ^[a-zA-Z0-9_-]{1,64}$" },
        { status: 400 }
      );
    }

    // Validate that either http or client is set, but not both
    if (body.definition?.http && body.definition?.client) {
      return c.json(
        { error: "Only one implementation (http or client) should be set" },
        { status: 400 }
      );
    }

    if (!body.definition?.http && !body.definition?.client) {
      return c.json(
        { error: "Either http or client implementation must be set" },
        { status: 400 }
      );
    }

    // For client tools, validate only body parameters are used
    if (body.definition?.client) {
      const hasNonBodyParams = [...(body.definition.dynamicParameters || []), 
        ...(body.definition.staticParameters || []), 
        ...(body.definition.automaticParameters || [])]
        .some((param) => param.location !== "PARAMETER_LOCATION_BODY");

      if (hasNonBodyParams) {
        return c.json(
          { error: "Client tools can only use body parameters" },
          { status: 400 }
        );
      }
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    const data = await toolService.createTool(body, userId);
    return c.json(data);
  } catch (error) {
    console.error("Error creating tool:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
};

export const getAllTools = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    const tools = await toolService.getUserTools(userId);
    return c.json({ tools });
  } catch (error) {
    console.error("Error fetching tools:", error);
    return c.json(
      { error: "Failed to fetch tools" },
      { status: 500 }
    );
  }
};

export const getTool = async (c: Context) => {
  try{
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    const tool = await toolService.getTool(toolId, userId);
    return c.json({ tool });

  }catch(error){
    console.error("Error fetching tool:", error);
    return c.json(
      { error: "Failed to fetch tool" },
      { status: 500 }
    );
  }
};

export const deactivateTool = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    await toolService.deactivateTool(toolId, userId);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deactivating tool:", error);
    return c.json(
      { error: "Failed to deactivate tool" },
      { status: 500 }
    );
  }
};

export const updateTool = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');
    const body = await c.req.json() as Partial<CreateToolRequest>;

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    // Validate tool name if provided
    if (body.name && body.name.length > 40) {
      return c.json(
        { error: "Tool name must not exceed 40 characters" },
        { status: 400 }
      );
    }

    // Validate modelToolName if provided
    if (body.definition?.modelToolName && !/^[a-zA-Z0-9_-]{1,64}$/.test(body.definition.modelToolName)) {
      return c.json(
        { error: "modelToolName must match pattern ^[a-zA-Z0-9_-]{1,64}$" },
        { status: 400 }
      );
    }

    // Validate implementation if provided
    if (body.definition) {
      if (body.definition.http && body.definition.client) {
        return c.json(
          { error: "Only one implementation (http or client) should be set" },
          { status: 400 }
        );
      }

      // For client tools, validate only body parameters are used
      if (body.definition.client) {
        const hasNonBodyParams = [...(body.definition.dynamicParameters || []), 
          ...(body.definition.staticParameters || []), 
          ...(body.definition.automaticParameters || [])]
          .some((param) => param.location !== "PARAMETER_LOCATION_BODY");

        if (hasNonBodyParams) {
          return c.json(
            { error: "Client tools can only use body parameters" },
            { status: 400 }
          );
        }
      }
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    await toolService.updateTool(toolId, userId, body);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error updating tool:", error);
    return c.json(
      { error: "Failed to update tool" },
      { status: 500 }
    );
  }
};

export const deleteTool = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const toolId = c.req.param('toolId');
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const toolService = ToolService.getInstance(env, c.req.db);
    await toolService.deleteTool(toolId, userId);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting tool:", error);
    return c.json(
      { error: "Failed to delete tool" },
      { status: 500 }
    );
  }
};
