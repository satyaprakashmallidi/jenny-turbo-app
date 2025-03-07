import { Context } from "hono";
import { getEnv } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";

export const createPhoneNumber =  async (c: Context) => {
    try {
      const env = getEnv(c.env)
      const supabase = getSupabaseClient(env);
      
      const body = await c.req.json()
      const { account_id, phone_number, friendly_name , user_id } = body
  
      if (!account_id || !phone_number || !friendly_name || !user_id) {
        return c.json({
          status: 'error',
          message: 'Missing parameters : account_id, phone_number, friendly_name, user_id',
        }, 500);
      }
  
      const { data: account, error: accountError } = await supabase
        .from('twilio_account')
        .select('id , user_id')
        .eq('id', account_id)
        .eq('user_id', user_id)
        .single();
  
      if (accountError) {
        console.error("Received /twilio/phone-number Error", accountError);
        return c.json({
          status: 'error',
          message: 'Internal Server Error While Getting Account',
          error: accountError,
        }, 500);
      }
  
      if(!account) {
        return c.json({
          status: 'error',
          message: 'Account not found',
        }, 404);
      }
      
      if(account?.user_id !== user_id) {
        return c.json({
          status: 'error',
          message: 'Unauthorized',
        }, 401);
      }
      
      const { data, error } = await supabase
        .from('twilio_phone_numbers')
        .insert([{
          account_id,
          phone_number,
          friendly_name,
          is_active: true
        }])
        .select();
  
      if (error) {
        console.error("Received /twilio/phone-number Error", error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error: error,
        }, 500);
      }
  
      return c.json({
        status: 'success',
        data: data[0],
      })
    } catch(error) {
      console.error("Create Phone Number Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
  }

export const updatePhoneNumber =  async (c: Context) => {
    try {
      const env = getEnv(c.env)
      const supabase = getSupabaseClient(env);
      const id = c.req.param('id')
      const body = await c.req.json()
      const { phone_number, friendly_name , user_id } = body
  
      if (!phone_number || !friendly_name || !id || !user_id) {
        return c.json({
          status: 'error',
          message: 'Missing parameters : phone_number, friendly_name, user_id',
        }, 500);
      }
  
    let { data: accountDetails , error: accountDetailsError } = await supabase
      .from('twilio_phone_numbers')
      .select('id , account_id')
      .eq('id', id)
      .single();
  
    if (accountDetailsError) {
      console.error("Received /twilio/phone-number Error", accountDetailsError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error While Getting Account',
        error: accountDetailsError,
      }, 500);
    }
  
    const { data: account, error: accountError } = await supabase
      .from('twilio_account')
      .select('id , user_id')
      .eq('id', accountDetails?.account_id)
      .single();
  
    if (accountError) {
      console.error("Received /twilio/phone-number Error", accountError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error While Getting Account',
        error: accountError,
      }, 500);
    }
  
    if(!account) {
      return c.json({
        status: 'error',
        message: 'Account not found',
      }, 404);
    }
    
    if(account?.user_id !== user_id) {
      return c.json({
        status: 'error',
        message: 'Unauthorized',
      }, 401);
    }
    
  
      const { data, error } = await supabase
        .from('twilio_phone_numbers')
        .update({
          phone_number,
          friendly_name
        })
        .eq('id', id)
        .select();
  
      if (error) {
        console.error("Received /twilio/phone-number/update Error", error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error: error,
        }, 500);
      }
  
      return c.json({
        status: 'success',
        data: data[0],
      })
    } catch(error) {
      console.error("Update Phone Number Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
  }

export const deletePhoneNumber =  async (c: Context) => {
    try {
      const env = getEnv(c.env)
      const supabase = getSupabaseClient(env);
      const id = c.req.param('id')
  
      const body = await c.req.json()
      const { user_id } = body;
      
  
    const {data : accountDetails , error: accountDetailsError } = await supabase
      .from('twilio_phone_numbers')
      .select('id , account_id')
      .eq('id', id)
      .single();
  
    if (accountDetailsError) {
      console.error("Received /twilio/phone-number Error", accountDetailsError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error While Getting Account Details',
        error: accountDetailsError,
      }, 500);
    }
  
    if(!accountDetails) {
      return c.json({
        status: 'error',
        message: 'Account Details not found',
      }, 404);
    }
  
    const { data: account, error: accountError } = await supabase
      .from('twilio_account')
      .select('id , user_id')
      .eq('id', accountDetails?.account_id)
      .single();
  
    if (accountError) {
      console.error("Received /twilio/phone-number Error", accountError);
      return c.json({
        status: 'error',
        message: 'Internal Server Error While Getting Account',
        error: accountError,
      }, 500);
    }
  
    if(!account) {
      return c.json({
        status: 'error',
        message: 'Account not found',
      }, 404);
    }
    
    if(account?.user_id !== user_id) {
      return c.json({
        status: 'error',
        message: 'Unauthorized',
      }, 401);
    }
    
      const { data, error } = await supabase
        .from('twilio_phone_numbers')
        .update({
          is_active: false
        })
        .eq('id', id)
        .select();
  
      if (error) {
        console.error("Received /twilio/phone-number/delete Error", error);
        return c.json({
          status: 'error',
          message: 'Internal Server Error',
          error: error,
        }, 500);
      }
  
      return c.json({
        status: 'success'
      })
    } catch(error) {
      console.error("Delete Phone Number Error", error);
      return c.json({
        status: 'error',
        message: 'Internal Server Error',
        error: error,
      }, 500);
    }
  }