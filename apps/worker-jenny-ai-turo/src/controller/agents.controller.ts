import { Context } from "hono";
import { getEnv } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";
import { UltravoxAgentService } from "../services/ultravox-agent.service";

export const createAgent = async (c: Context) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const {
      name,
      user_id,
      voice_id,
      system_prompt,
      model = "fixie-ai/ultravox",
      temperature = 7,
      first_speaker = "FIRST_SPEAKER_USER",
      selected_tools = []
    } = body

    if (!name  || !user_id || !voice_id || !system_prompt) {
      console.error("Recevied /agent/createAgent Error : Missing parameters",{
        name : name,
        user_id : user_id,
        voice_id : voice_id,
        system_prompt : system_prompt
      });
      return c.json({
        status: 'error',
        message: 'Missing parameters',
        error: {
          name : name,
          user_id : user_id,
          voice_id : voice_id,
          system_prompt : system_prompt
        }
      }, 500);
    }

    // Create Ultravox Agent first (new approach)
    const agentService = UltravoxAgentService.getInstance(env, supabase);

    console.log("[AgentController] Creating Ultravox Agent for bot:", name);
    const ultravoxAgent = await agentService.createAgent(
      agentService.mapBotToAgentRequest({
        name,
        system_prompt,
        voice: voice_id,
        model,
        temperature,
        selected_tools,
        first_speaker: first_speaker as "FIRST_SPEAKER_AGENT" | "FIRST_SPEAKER_USER",
      })
    );

    console.log("[AgentController] Ultravox Agent created:", ultravoxAgent.agentId);

    // Store bot in DB with Ultravox Agent reference
    const { data: insertedBot, error } = await supabase
        .from("bots")
        .insert([{
          name,
          phone_number: "",
          voice: voice_id,
          is_deleted: false,
          created_at: new Date(),
          is_appointment_booking_allowed: false,
          user_id: user_id,
          system_prompt: system_prompt,
          model,
          temperature,
          first_speaker,
          selected_tools,
          is_agent: true, // New field
          ultravox_agent_id: ultravoxAgent.agentId, // New field
          ultravox_published_revision_id: ultravoxAgent.publishedRevisionId, // New field
          last_synced_at: new Date().toISOString(), // New field
        }])
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/create Error",error);

      // Rollback: Delete Ultravox Agent if DB insert fails
      console.log("[AgentController] Rolling back Ultravox Agent:", ultravoxAgent.agentId);
      try {
        await agentService.deleteAgent(ultravoxAgent.agentId);
      } catch (deleteError) {
        console.error("[AgentController] Failed to rollback Ultravox Agent:", deleteError);
      }

      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: insertedBot ,
    })
  }catch(error){
    console.error("Recevied /agent/create Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error instanceof Error ? error.message : error ,
    } , 500);
  }
}

export const updateAgent = async (c: Context) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { id, name, twilio_from_number, voice_id, system_prompt } = body

    const { data: insertedBot, error } = await supabase
        .from("bots")
        .update({
          name,
          phone_number: twilio_from_number,
          voice :voice_id,
          system_prompt: system_prompt,
        })
        .eq('id', id)
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/update Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: insertedBot ,
    })
  }catch(error){
    console.error("Recevied /agent/update Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
}

export const deleteAgent = async (c: Context) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);

    const id  = c.req.query('id')

    if (!id) {
      console.error("Recevied /agent/delete Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    const {data: existingBot, error: supabaseError } = await supabase
        .from("bots")
        .select()
        .eq('id', id)
        .single();

    if (!existingBot){
      console.error("Recevied /agent/delete Error : Bot not found");
      return c.json({
        status: 'error',
        message: 'Bot with id ' + id + ' not found',
      } , 500);
    }
    if (existingBot?.is_deleted){
      console.error("Recevied /agent/delete Error : Bot already deleted");
      return c.json({
        status: 'error',
        message: 'Bot with id ' + id + ' already deleted',
      } , 500);
    }
    if (supabaseError){
      console.error("Recevied /agent/delete Error", supabaseError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  supabaseError ,
      } , 500);
    }

    // If this is an agent-based bot, delete from Ultravox first
    if (existingBot.is_agent && existingBot.ultravox_agent_id) {
      const agentService = UltravoxAgentService.getInstance(env, supabase);
      console.log("[AgentController] Deleting Ultravox Agent:", existingBot.ultravox_agent_id);

      try {
        await agentService.deleteAgent(existingBot.ultravox_agent_id);
        console.log("[AgentController] Ultravox Agent deleted successfully");
      } catch (deleteError) {
        // Log error but don't fail the operation - local soft delete should still proceed
        console.error("[AgentController] Failed to delete Ultravox Agent (continuing with local delete):", deleteError);
      }
    }

    // Soft delete in local DB
    const { data: deletedBot, error } = await supabase
        .from("bots")
        .update({
          is_deleted: true,
        })
        .eq('id', id)
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/delete Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: deletedBot ,
    })
  }catch(error){
    console.error("Recevied /agent/delete Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
}

export const getAgent = async (c: Context) => {
  try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id  = c.req.param('id')
    if (!id) {
      console.error("Recevied /agent/get Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }
    const { data: insertedBot, error } = await supabase
      .from("bots")
      .select()
      .eq('id', id)
      .single();

    if (insertedBot?.is_deleted) {
      console.error("Recevied /agent/get Error : Bot not found");
      return c.json({
        status: 'error',
        message: 'Bot not found',
      }, 404);
    }
    if (error) {
      console.error("Recevied /agent/get Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
    return c.json({
      status: 'success',
      data: insertedBot,
    })
  } catch (error) {
    console.error("Recevied /agent/get Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error,
    }, 500);
  }
}

export const getAllAgents = async (c: Context) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);

    const user_id = c.req.query('user_id')

    if (!user_id) {
      console.error("Recevied /agent/getAllAgents Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing parameters',
      }, 500);
    }

    const { data: insertedBot, error } = await supabase
        .from("bots")
        .select()
        .eq('user_id', user_id);


    const filteredBots = insertedBot?.filter((bot) => !bot.is_deleted);

    if (error){
      console.error("Recevied /agent/getAllAgents Error",error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  error ,
      } , 500);
    }
    return c.json({
      status: 'success',
      data: filteredBots ,
    })
  }catch(error){
    console.error("Recevied /agent/get Error",error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error:  error ,
    } , 500);
  }
}

/**
 * Sync bot configuration to Ultravox Agent (manual sync)
 * Can also be used to migrate an old bot (is_agent=false) to use Agent API
 */
export const syncAgent = async (c: Context) => {
  try {
    const env = getEnv(c.env);
    const supabase = getSupabaseClient(env);
    const body = await c.req.json();
    const { id } = body;

    if (!id) {
      console.error("Received /agent/sync Error : Missing parameters");
      return c.json({
        status: 'error',
        message: 'Missing bot ID',
      }, 400);
    }

    // Fetch bot from DB
    const { data: bot, error: fetchError } = await supabase
      .from("bots")
      .select()
      .eq('id', id)
      .single();

    if (fetchError || !bot) {
      console.error("Received /agent/sync Error : Bot not found", fetchError);
      return c.json({
        status: 'error',
        message: 'Bot not found',
      }, 404);
    }

    if (bot.is_deleted) {
      return c.json({
        status: 'error',
        message: 'Cannot sync deleted bot',
      }, 400);
    }

    const agentService = UltravoxAgentService.getInstance(env, supabase);

    // If bot is already an agent, update it
    if (bot.is_agent && bot.ultravox_agent_id) {
      console.log("[AgentController] Syncing bot to existing Ultravox Agent:", bot.ultravox_agent_id);

      const updatedAgent = await agentService.updateAgent(
        bot.ultravox_agent_id,
        {
          name: bot.name,
          callTemplate: {
            systemPrompt: bot.system_prompt,
            voice: bot.voice,
            model: bot.model || "fixie-ai/ultravox",
            temperature: bot.temperature > 0 ? Number(`0.${bot.temperature}`) : 0,
            firstSpeaker: bot.first_speaker || "FIRST_SPEAKER_USER",
            recordingEnabled: true,
            selectedTools: [],
            medium: { twilio: {} },
          },
        }
      );

      // Update last_synced_at and published_revision_id
      const { data: updatedBot, error: updateError } = await supabase
        .from("bots")
        .update({
          ultravox_published_revision_id: updatedAgent.publishedRevisionId,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        console.error("Failed to update bot sync timestamp:", updateError);
      }

      return c.json({
        status: 'success',
        message: 'Bot synced successfully',
        data: updatedBot || bot,
      });
    }

    // If bot is NOT an agent, create new Ultravox Agent (migration path)
    console.log("[AgentController] Migrating bot to Ultravox Agent:", bot.name);

    const newAgent = await agentService.createAgent(
      agentService.mapBotToAgentRequest({
        name: bot.name,
        system_prompt: bot.system_prompt,
        voice: bot.voice,
        model: bot.model || "fixie-ai/ultravox",
        temperature: bot.temperature || 7,
        selected_tools: bot.selected_tools || [],
        first_speaker: (bot.first_speaker || "FIRST_SPEAKER_USER") as "FIRST_SPEAKER_AGENT" | "FIRST_SPEAKER_USER",
      })
    );

    // Update bot to mark as agent
    const { data: migratedBot, error: migrateError } = await supabase
      .from("bots")
      .update({
        is_agent: true,
        ultravox_agent_id: newAgent.agentId,
        ultravox_published_revision_id: newAgent.publishedRevisionId,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (migrateError) {
      console.error("Failed to update bot after migration:", migrateError);
      // Rollback: delete the created agent
      try {
        await agentService.deleteAgent(newAgent.agentId);
      } catch (deleteError) {
        console.error("Failed to rollback agent after migration error:", deleteError);
      }

      return c.json({
        status: 'error',
        message: 'Failed to migrate bot',
        error: migrateError,
      }, 500);
    }

    return c.json({
      status: 'success',
      message: 'Bot migrated to agent mode successfully',
      data: migratedBot,
    });
  } catch (error) {
    console.error("Received /agent/sync Error", error);
    return c.json({
      status: 'error',
      message: 'Internal Server Error',
      error: error instanceof Error ? error.message : error,
    }, 500);
  }
}
