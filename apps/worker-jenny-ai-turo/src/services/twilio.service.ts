import { CallConfig, CallConfigWebhookResponse, JoinUrlResponse, twilioData } from "@repo/common-types/types";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Env } from "../config/env";
import twilio from 'twilio';

type CallRecord = {
    config: CallConfig;
    twilioResponseData: twilioData;
    joinUrlResponse: JoinUrlResponse;
    twilioData: {
        auth_token: string;
        account_sid: string;
        from_phone_number: string;
        to_number: string;
        user_id: string;
    };
    transferTo?: string | "+919014325088";
};

type UrgencyLevel = 'low' | 'medium' | 'high';

interface TransferCallRequest {
    transferReason: string;
    urgencyLevel: UrgencyLevel;
}

export class TwilioService {
    private static instance: TwilioService;
    private supabaseClient: SupabaseClient | null = null;
    private env: Env | null = null;
    private static readonly CALLS_PATH = '/calls';

    private constructor() {
        this.supabaseClient = createClient(
            "https://usjdmsieclzehogkqlag.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzamRtc2llY2x6ZWhvZ2txbGFnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzExMjE5NCwiZXhwIjoyMDQ4Njg4MTk0fQ.zMcR9bMMw4zOdV1hvwtIdCfdyNM9rmOatN2zeKgenUw"
        );
    }

    private activeCalls: Record<string, CallRecord> = {};

    public getActiveCalls() {
        return this.activeCalls;
    }

    public static getInstance(): TwilioService {
        if (!TwilioService.instance) {
            TwilioService.instance = new TwilioService();
        }
        return TwilioService.instance;
    }

    public setDependencies(supabase: SupabaseClient, env: Env) {
        this.supabaseClient = supabase;
        this.env = env;
    }

    public hasDependencies(): boolean {
        if (!this.supabaseClient || !this.env) {
            return false;
        }
        return true;
    }

    // Store call data in KV
    private async storeCallData(callId: string, callData: CallRecord) {
        if (!this.env) throw new Error('Environment not initialized');
        
        try {
            await this.env.ACTIVE_CALLS.put(callId, JSON.stringify(callData));
            console.log("Stored call data for:", callId);
        } catch (error) {
            console.error("Error storing call data:", error);
            throw new Error('Failed to store call data');
        }
    }

    // Get call data from KV
    private async getCallData(callId: string) : Promise<CallRecord | null> {
        if (!this.env) throw new Error('Environment not initialized');
        
        try {
            const data = await this.env.ACTIVE_CALLS.get(callId);
            if (!data) {
                console.log("No call data found for:", callId);
                return null;
            }
            return JSON.parse(data);
        } catch (error) {
            console.error("Error fetching call data:", error);
            return null;
        }
    }

    // Delete call data from KV
    private async deleteCallData(callId: string) {
        if (!this.env) throw new Error('Environment not initialized');
        
        try {
            await this.env.ACTIVE_CALLS.delete(callId);
            console.log("Deleted call data for:", callId);
        } catch (error) {
            console.error("Error deleting call data:", error);
        }
    }

    async makeCall(params: {
        callConfig: CallConfig;
        botId: string;
        toNumber: string;
        twilioFromNumber: string;
        userId: string;
        placeholders?: Record<string, string>;
        tools: string[];
        supabase: SupabaseClient;
        env: Env;
        transferTo?: string;
        isSingleTwilioAccount?: boolean;
    }) {
        const { botId, toNumber, twilioFromNumber, userId, placeholders, tools, supabase, env, transferTo, isSingleTwilioAccount, callConfig : call_config } = params;

        let account_sid = "";
        let auth_token = "";
        if(!botId || !toNumber || !twilioFromNumber || !userId){
            throw new Error("Missing parameters");
        }

        // Get bot details
            const { data: bot, error: botError } = await supabase
                .from('bots')
                .select('voice, system_prompt')
                .eq('id', botId)
                .eq('user_id', userId)
                .single();

            if (botError) {
                throw new Error("Bot not found");
            }
        

        // Get Twilio number details
        const { data: twilioNumber, error: twilioNumberError } = await supabase
            .from('twilio_phone_numbers')
            .select('id , account_id')
            .eq('phone_number', twilioFromNumber);
        
            console.log(twilioNumber , "i am getting data from twilio_number table haha");

        if (twilioNumberError) {
            throw new Error("Twilio Number not found");
        }

        // Get Twilio account details
        const { data: twilioAccount, error: twilioAccountError } = await supabase
            .from('twilio_account')
            .select('account_sid, auth_token , user_id')
            .eq('id', twilioNumber[0].account_id)
            .single();

        if (twilioAccountError) {
            throw new Error("Twilio Account not found for This User");
        }

        if(twilioAccount.user_id !== userId) {
            throw new Error("Unauthorized to use this Twilio Account");
        }

        account_sid = twilioAccount.account_sid;
        auth_token = twilioAccount.auth_token;

        if(isSingleTwilioAccount){
            const { data: singleTwilioAccount, error: singleTwilioAccountError } = await supabase
            .from('twilio_credentials')
            .select('account_sid, auth_token')
            .eq('user_id', userId)
            .single();

            if(singleTwilioAccountError){
                throw new Error("Twilio Account not found");
            }

            account_sid = singleTwilioAccount.account_sid;
            auth_token = singleTwilioAccount.auth_token;
        }

        let { voice, systemPrompt: system_prompt } = call_config || {};

        if(!voice || !system_prompt){
            voice = bot.voice;
            system_prompt = bot.system_prompt;
        }

        // Replace placeholders in system prompt
        if(placeholders) {
            let leftDelimiter = placeholders?.left_delimeter || "<<<";
            let rightDelimiter = placeholders?.right_delimeter || ">>>";
            const regexPattern = new RegExp(`${leftDelimiter}(\\w+)${rightDelimiter}`, 'g');
            system_prompt = system_prompt.replace(regexPattern, (match: string, key: string) => placeholders[key] || match);
        }

        interface ToolItem {
            toolName?: string;
            toolId?: string;
            parameterOverrides?: Record<string, any>;
            [key: string]: any; 
        }
        
        let processedTools: ToolItem[] = [];
        if (tools && Array.isArray(tools)) {
            processedTools = tools.map((tool: any) => {
                if (typeof tool === 'object' && tool !== null && tool.toolName) {
                    return tool as ToolItem;
                }
                if (typeof tool === 'string') {
                    return { toolId: tool } as ToolItem;
                }
                return null;
            }).filter(Boolean) as ToolItem[]; 
        }

        const callConfig: CallConfig = {
            systemPrompt: system_prompt,
            voice: voice,
            recordingEnabled: true,
            joinTimeout: "30s",
            medium: {
                twilio: {}
            },
            selectedTools: [
                { toolName: "transferCall" },
                ...processedTools
            ]
        };

        // Create Ultravox call
        const ultravoxResponse = await fetch('https://api.ultravox.ai/api/calls', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': env.ULTRAVOX_API_KEY,
            },
            body: JSON.stringify(callConfig),
        });

        if (!ultravoxResponse.ok) {
            const errorText = await ultravoxResponse.text();
            throw new Error(`${errorText}`);
        }
        
        const ultravoxData: JoinUrlResponse = await ultravoxResponse.json();
        const { joinUrl, callId: ultravoxCallId } = ultravoxData;

        let additional_data_to_store_in_call_records: {
            placeholders?: any;
            transferTo?: string;
            isSingleTwilioAccount?: boolean;
        } = {};

        if(placeholders) {
            additional_data_to_store_in_call_records.placeholders = placeholders;
        }

        if(transferTo) {
            additional_data_to_store_in_call_records.transferTo = transferTo;
        }

        if(isSingleTwilioAccount) { 
            additional_data_to_store_in_call_records.isSingleTwilioAccount = true;
        }
        
        //the call is sucess push it to db
        const { data: pushedCallToCallRecords , error: errorPushedCallToCallRecords  } = await supabase
            .from('call_records')
            .insert([{ user_id: userId, call_id: ultravoxCallId,  bot_id: botId, additional_data: additional_data_to_store_in_call_records}])
            .select();

        if(errorPushedCallToCallRecords) {
          console.error("Error pushing call to call records", errorPushedCallToCallRecords);
        }

        // Create Twilio call
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Calls.json`;
        const twilioResponse = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(`${account_sid}:${auth_token}`)
            },
            body: new URLSearchParams({
                To: toNumber,
                From: twilioFromNumber,
                Twiml: `<Response><Connect><Stream url="${joinUrl}" /></Connect></Response>`,
            })
        });

        if (!twilioResponse.ok) {
            const errorText = await twilioResponse.text();
            const errorData = await JSON.parse(errorText);
            if(errorData?.code === 20003) {
                throw new Error(`Wrong Account Sid / Account Suspended`);
            }
            throw new Error(`Twilio API error: ${errorText}`);
        }

        const twilioData: twilioData = await twilioResponse.json();

        console.log("added this call to activeCalls", ultravoxCallId , transferTo , "trans");

        // Store call data in KV
        await this.storeCallData(ultravoxCallId, {
            config: callConfig,
            twilioResponseData: twilioData,
            joinUrlResponse: ultravoxData,
            twilioData: {
                auth_token,
                account_sid,
                from_phone_number: twilioFromNumber,
                to_number: toNumber,
                user_id: userId
            },
            transferTo: transferTo
        });

        return {
            from_number: twilioFromNumber,
            to_number: toNumber,
            bot_id: botId,
            status: twilioData.status
        };
    }

    async transferCall(body: TransferCallRequest, callId: string) {
        const { transferReason, urgencyLevel } = body;

        console.log("Transfer Call Request: ", body);

        // Get call data from KV
        const call = await this.getCallData(callId);
        if (!call) {
            console.error("Call not found:", callId);
            throw new Error('Call not found');
        }

        console.log("Call data transfer call: ", call);

        const { transferTo } = call;

        console.log("Transfering the call to: ", transferTo);

        const { config: callConfig, twilioData, joinUrlResponse, twilioResponseData } = call;

        const client = twilio(twilioData.account_sid, twilioData.auth_token);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.dial().number(transferTo as string);

        const UpdatedCall = await client.calls(twilioResponseData.sid).update({
            twiml: twiml.toString()
        });

        return {
            callId,
            transferReason,
            urgencyLevel,
            status: 'transferring'
        };
    }

    async finishCall(mixedCallConfig: { 
        event: "call.started" | "call.ended" | "call.joined",
        call: CallConfigWebhookResponse,
        supabaseClient: any 
    }) {
        const { event, call: callConfig, supabaseClient } = mixedCallConfig;
        const { callId, medium } = callConfig;

        try {
            const TimeTaken = new Date(callConfig.ended).getTime() - new Date(callConfig.joined).getTime();
            console.log("TimeTaken: ", TimeTaken);


            if(callConfig.endReason === 'unjoined') {
                console.log("Call ended with reason 'unjoined'");
                await this.deleteCallData(callId);
                return;
            }

            // Get call data from KV
            const call = await this.getCallData(callId);
            if (!call) {
                console.error("Call not found:", callId);
                return{
                    userId: null,
                    TimeTaken: TimeTaken,
                    callId: null
                };
            }

            const { twilioData: { user_id: userId, from_phone_number: account_name } } = call;

            // Clean up call data
            await this.deleteCallData(callId);

            return {
                userId,
                TimeTaken,
                callId
            };

        } catch (error) {
            console.error("Error in finishCall:", error);
            throw error;
        }
    }

    deleteCall(callSid: string) {
        if(!this.activeCalls[callSid]) {
            return;
        }
        delete this.activeCalls[callSid];
    }

    private async getUserIdFromAccountSid(accountSid: string): Promise<false | { user_id: string, account_name: string }> {
        console.log("Fetching user ID for account SID", accountSid);
        try {
            console.log("Making Supabase query...");
            
            if (!this.supabaseClient) {
                console.error("SupabaseClient is null or undefined");
                return false;
            }

            try {
                console.log("Starting Supabase query execution...");
                
                // Create a promise that rejects after 5 seconds
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Query timeout after 5 seconds')), 5000);
                });

                // Create the actual query promise
                const queryPromise = this.supabaseClient
                    .from('twilio_account')
                    .select('user_id, account_name')
                    .eq('account_sid', accountSid)
                    .then((response : any) => {
                        console.log("Initial query response received");
                        return response;
                    });

                // Race between the timeout and the query
                const response = await Promise.race([queryPromise, timeoutPromise])
                    .catch(error => {
                        console.error("Query execution error or timeout:", error);
                        throw error;
                    });

                console.log("Query complete, processing response:", JSON.stringify(response, null, 2));
                
                const { data, error } = response as any;

                if (error) {
                    console.error("Supabase query error:", error);
                    return false;
                }

                if (!data || data.length === 0) {
                    console.error("No data found for account SID:", accountSid);
                    return false;
                }

                console.log("Successfully fetched user data:", data[0]);
                return { user_id: data[0].user_id, account_name: data[0].account_name };
            } catch (queryError) {
                console.error("Error during Supabase query execution:", queryError);
                console.error("Query error details:", JSON.stringify(queryError, null, 2));
                return false;
            }
        }
        catch (error) {
            console.error("Top level error in getUserIdFromAccountSid:", error);
            console.error("Error details:", JSON.stringify(error, null, 2));
            return false;
        }
    }

    private async updateUserPricing(userId: string, TimeTaken: number, supabaseClient : any) {

        const timeInSeconds = Math.ceil(TimeTaken / 1000); // Convert ms to seconds
        console.log("Updating pricing for user", userId, "reducing time by", timeInSeconds, "seconds");

        // Use Postgres decrement operation
        const { data: pricing, error } = await supabaseClient.rpc(
            'decrement_time_rem',
            { user_id: userId, seconds_to_subtract: timeInSeconds }
        );

        if(error){
            console.error("Error updating pricing:", error);
            throw new Error('Failed to update pricing');
        }

        console.log("Successfully updated pricing. New time_rem:", pricing);
        return pricing;
    }
}