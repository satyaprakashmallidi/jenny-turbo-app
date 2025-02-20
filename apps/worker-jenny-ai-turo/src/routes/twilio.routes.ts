import { Hono } from "hono";
import { createAccount, deleteAccount, getAccount, getAllAccounts, updateAccount } from "../controller/twilio.controller";
import { getEnv , Env } from "../config/env";
import { SupabaseClient } from "@supabase/supabase-js";

declare module 'hono' {
    interface HonoRequest {
      db: SupabaseClient,
      env: Env
    }
  }

const twilioRoutes = new Hono<{ Bindings: Env }>();

twilioRoutes.get('/accounts', getAllAccounts);
twilioRoutes.get('/account/:id', getAccount);
twilioRoutes.post('/account', createAccount);
twilioRoutes.patch('/account/:id', updateAccount);
twilioRoutes.delete('/account/:id', deleteAccount);

export default twilioRoutes;