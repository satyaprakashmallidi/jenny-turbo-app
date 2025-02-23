import { Context } from "hono";
import { getEnv } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";

export const createAgent = async (c: Context) => {
  try{
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const body = await c.req.json()
    const { name, user_id, voice_id, system_prompt } = body

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

    await fetch('https://api.ultravox.ai/api/voices/' + voice_id, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.ULTRAVOX_API_KEY,
      },
    })
      .then(res => res.json())  
      .then(data => {
        console.log("Ultravox API response:", data);
      })
      .catch(error => {
        console.error("Ultravox Voice API error:", error);
        return c.json({
          status: 'error',
          message: 'Invalid Voice ID',
        } , 500);
      });
      
    const { data: insertedBot, error } = await supabase
        .from("bots")
        .insert([{
          name,
          phone_number: "",
          voice :voice_id,
          is_deleted: false,
          created_at: new Date(),
          is_appointment_booking_allowed: false,
          user_id: user_id,
          system_prompt: system_prompt,
        }])
        .select()
        .single();

    if (error){
      console.error("Recevied /agent/create Error",error);
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
      error:  error ,
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

    if (supabaseError){
      console.error("Recevied /agent/delete Error", supabaseError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error:  supabaseError ,
      } , 500);
    }

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
