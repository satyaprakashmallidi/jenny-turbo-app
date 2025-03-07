import { Context } from "hono";
import { getEnv } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";

export const getAllSingleAccounts = async (c: Context) => {
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
        .from('twilio_credentials')
        .select('id, account_sid, auth_token, from_phone_number')
        .eq('user_id', user_id);
  
      if (error) {
        console.error("Received /single-twilio/accounts Error", error);
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
      console.error("Get Single Accounts Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
}

export const createSingleAccount = async (c: Context) => {
    try {
        const env = getEnv(c.env)
        const supabase = getSupabaseClient(env);
        const body = await c.req.json()
        const { account_sid, auth_token, user_id, phone_number } = body

        if (!account_sid || !auth_token || !user_id || !phone_number) {
            return c.json({
                status: 'error',
                message: 'Missing parameters',
            }, 500);
        }

        const { data, error } = await supabase
            .from('twilio_credentials')
            .insert([{
                account_sid,
                auth_token,
                user_id,
                from_phone_number : phone_number
            }])
            .select()
            .single();

        if (error) {
            console.error("Error creating Twilio credentials:", error);
            return c.json({
                status: 'error',
                message: 'Failed to create Twilio credentials',
                error: error,
            }, 500);
        }

        const response = {
            ...data,
        };
        delete response.user_id;
        delete response.created_at;

        return c.json({
            status: 'success',
            data: response
        });
    } catch(error) {
        console.error("Create Single Account Error:", error);
        return c.json({
            status: 'error',
            message: 'Internal Server Error',
            error: error,
        }, 500);
    }
}

export const updateSingleAccount = async (c: Context) => {
    try {
        const env = getEnv(c.env)
        const supabase = getSupabaseClient(env);
        const id = c.req.param('id')
        const body = await c.req.json()
        const { account_sid, auth_token, user_id, phone_number } = body

        if (!account_sid || !auth_token || !user_id || !phone_number) {
            return c.json({
                status: 'error',
                message: 'Missing parameters',
            }, 500);
        }

        const { data, error } = await supabase
            .from('twilio_credentials')
            .update({
                account_sid,
                auth_token,
                from_phone_number : phone_number
            })
            .eq('id', id)
            .eq('user_id', user_id)
            .select()
            .single();
        if(error?.code === 'PGRST116') {
            return c.json({
                status: 'error',
                message: 'Credentials not found, please create a new account',
            }, 404);
        }

        if (error) {
            return c.json({
                status: 'error',
                message: 'Failed to update credentials',
                error: error,
            }, 500);
        }

        const response = {
            ...data,
        };
        delete response.user_id;
        delete response.created_at;

        return c.json({
            status: 'success',
            data: response
        });
    } catch(error) {
        console.error("Update Single Account Error:", error);
        return c.json({
            status: 'error',
            message: 'Internal Server Error',
            error: error,
        }, 500);
    }
}

export const deleteSingleAccount = async (c: Context) => {
    try {
        const env = getEnv(c.env)
        const supabase = getSupabaseClient(env);
        const id = c.req.param('id')
        const body = await c.req.json()
        const { user_id } = body;

        const { error } = await supabase
            .from('twilio_credentials')
            .delete()
            .eq('id', id)
            .eq('user_id', user_id);

        if(error?.code === 'PGRST116') {
            return c.json({
                status: 'error',
                message: 'Credentials not found',
            }, 404);
        }

        if (error) {
            return c.json({
                status: 'error',
                message: 'Failed to delete credentials',
                error: error,
            }, 500);
        }

        return c.json({
            status: 'success',
            message: 'Credentials deleted successfully'
        });
    } catch(error) {
        console.error("Delete Single Account Error:", error);
        return c.json({
            status: 'error',
            message: 'Internal Server Error',
            error: error,
        }, 500);
    }
}

export const getSingleAccount = async (c: Context) => {
    try {
        const env = getEnv(c.env)
        const supabase = getSupabaseClient(env);
        const id = c.req.param('id')
        const body = await c.req.json();
        const { user_id } = body;

        const { data, error } = await supabase
            .from('twilio_credentials')
            .select('id, account_sid, auth_token, from_phone_number')
            .eq('id', id)
            .eq('user_id', user_id)
            .single();

        if(error?.code === 'PGRST116') {
            return c.json({
                status: 'error',
                message: 'Credentials not found',
            }, 404);
        }

        if (error) {
            return c.json({
                status: 'error',
                message: 'Failed to fetch credentials',
                error: error,
            }, 500);
        }

        return c.json({
            status: 'success',
            data: data
        });
    } catch(error) {
        console.error("Get Single Account Error:", error);
        return c.json({
            status: 'error',
            message: 'Internal Server Error',
            error: error,
        }, 500);
    }
} 