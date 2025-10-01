import { Hono } from "hono";
import { createAccount, deleteAccount, getAccount, getAllAccounts, updateAccount } from "../controller/twilio-account.controller";
import { Env } from "../config/env";
import { SupabaseClient } from "@supabase/supabase-js";
import { createPhoneNumber, deletePhoneNumber, updatePhoneNumber } from "../controller/twilio-phone.controller";
import { handleWebhook, makeCall, transferCall } from "../controller/twilio.controller";

declare module 'hono' {
    interface HonoRequest {
        db: SupabaseClient<any, 'public', any>,
        env: Env
    }
}

const twilioRoutes = new Hono<{ Bindings: Env }>();

// Account routes
twilioRoutes.get('/account', getAllAccounts);
twilioRoutes.get('/account/:id', getAccount);
twilioRoutes.post('/account', createAccount);
twilioRoutes.patch('/account/:id', updateAccount);
twilioRoutes.delete('/account/:id', deleteAccount);

// Phone number routes
twilioRoutes.post('/phone-number', createPhoneNumber);
twilioRoutes.patch('/phone-number/:id', updatePhoneNumber);
twilioRoutes.delete('/phone-number/:id', deletePhoneNumber);

// Call routes
twilioRoutes.post('/call', makeCall);
twilioRoutes.post('/transfer-call', transferCall);
twilioRoutes.post('/webhook', handleWebhook);

export default twilioRoutes;