import { Context } from "hono";
import { getEnv } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";


export const getAllAccounts = async (c: Context) => {
    try {
      const env = getEnv(c.env)
      const supabase = getSupabaseClient(env);
      const body = await c.req.json()
      const { user_id } = body
  
      if (!user_id) {
        return c.json({
          status: 'error',
          message: 'Missing user_id parameter',
        }, 500);
      }
  
      const { data, error } = await supabase
        .from('twilio_account')
        .select(`id, account_name, account_sid, auth_token`)
        .eq('user_id', user_id);
  
      if (error) {
        console.error("Received /twilio/accounts Error", error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error: error,
        }, 500);
      }
  
  
      return c.json({
        status: 'success',
        data: data,
      });
    } catch(error) {
      console.error("Get Accounts Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
}

export const createAccount = async (c: Context) => {
try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);

    const body = await c.req.json()
    const { account_name, account_sid, auth_token, user_id } = body

    if (!account_name || !account_sid || !auth_token || !user_id) {
    return c.json({
        status: 'error',
        message: 'Missing parameters',
    }, 500);
    }

    const { data, error } = await supabase
    .from('twilio_account')
    .insert([{
        account_name,
        account_sid,
        auth_token,
        user_id,
        is_active: true
    }])
    .select();

    if (error) {
    console.error("Received /twilio/account Error", error);
    return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
    }, 500);
    }

    if(data[0]?.user_id) {
    delete data[0].user_id;
    }

    return c.json({
    status: 'success',
    data: data[0],
    })
} catch(error) {
    console.error("Create Account Error", error);
    return c.json({
    status: 'error',
    message: 'Internal Server Error',
    error: error,
    }, 500);
}
}

export const updateAccount = async (c: Context) => {
    try {
      const env = getEnv(c.env)
      const supabase = getSupabaseClient(env);
      const id = c.req.param('id')
      const body = await c.req.json()
      const { account_name, account_sid, auth_token , user_id } = body
  
      if (!account_name || !account_sid || !auth_token || !user_id) {
        return c.json({
          status: 'error',
          message: 'Missing parameters',
        }, 500);
      }
  
      const { data, error } = await supabase
        .from('twilio_account')
        .update({
          account_name,
          account_sid,
          auth_token
        })
        .eq('id', id)
        .eq('user_id', user_id)
        .select();
  
      if (error) {
        console.error("Received /twilio/account/update Error", error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error: error,
        }, 500);
      }
  
      if(data[0]?.user_id) {
        delete data[0].user_id; 
      }
  
      return c.json({
        status: 'success',
        data: data[0],
      })
    } catch(error) {
      console.error("Update Account Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
}

export const deleteAccount = async (c: Context) => {
try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id = c.req.param('id')

    const body = await c.req.json()
    
    const { user_id } = body;

    const { data, error } = await supabase
    .from('twilio_account')
    .update({
        is_active: false
    })
    .eq('user_id', user_id)
    .eq('id', id)
    .select();

    if (error) {
    console.error("Received /twilio/account/delete Error", error);
    return c.json({
        status: 'error',
        message: 'Internal Server Error while deleting account',
        error: error,
    }, 500);
    }

    return c.json({
    status: 'success'
    })
} catch(error) {
    console.error("Delete Account Error", error);
    return c.json({
    status: 'error',
    message: 'Internal Server Error',
    error: error,
    }, 500);
}
}

export const getAccount = async (c: Context) => {
try {
    const env = getEnv(c.env)
    const supabase = getSupabaseClient(env);
    const id = c.req.param('id')

    const body = await c.req.json();
    const { user_id } = body;

    const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('id', user_id)
    .single();

    const { data, error } = await supabase
    .from('twilio_account')
    .select(`
        *,
        twilio_phone_numbers (*)
    `)
    .eq('id', id)
    .single();

    if (error) {
    console.error("Received /twilio/account Error", error);
    return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
    }, 500);
    }

    if(data?.user_id) {
    delete data.user_id;
    }

    return c.json({
    status: 'success',
    data: data,
    })
} catch(error) {
    console.error("Get Account Error", error);
    return c.json({
    status: 'error',
    message: 'Internal Server Error',
    error: error,
    }, 500);
}
}