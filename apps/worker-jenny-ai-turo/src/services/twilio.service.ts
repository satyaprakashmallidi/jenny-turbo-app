import { CallConfig, CallConfigWebhookResponse, JoinUrlResponse, twilioData } from "../types/repo-common-types";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Env } from "../config/env";
import twilio from 'twilio';
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { SelectedTool } from "@repo/common-types/types";

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

enum ParameterLocation {
    UNSPECIFIED = "PARAMETER_LOCATION_UNSPECIFIED",
    QUERY = "PARAMETER_LOCATION_QUERY",
    PATH = "PARAMETER_LOCATION_PATH",
    HEADER = "PARAMETER_LOCATION_HEADER",
    BODY = "PARAMETER_LOCATION_BODY",
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
            await this.env.ACTIVE_CALLS.put(callData.twilioResponseData.sid, callId);
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

    private async getCallDataByTwilioCallSid(callSid: string) : Promise<CallRecord | null> {
        if (!this.env) throw new Error('Environment not initialized');
        
        try {
            const call_id = await this.env.ACTIVE_CALLS.get(callSid);
            if (!call_id) {
                console.log("No call data found for:", callSid);
                return null;
            }
            const callData = await this.getCallData(call_id);
            return callData;
        } catch (error) {
            console.error("Error fetching call data:", error);
            return null;
        }
    }

    // Delete call data from KV
    private async deleteCallData(callId: string) {
        if (!this.env) throw new Error('Environment not initialized');

        const callData = await this.getCallData(callId);
        
        try {
            await this.env.ACTIVE_CALLS.delete(callId);
            await this.env.ACTIVE_CALLS.delete(callData?.twilioResponseData.sid || '');
            console.log("Deleted call data for:", callId);
        } catch (error) {
            console.error("Error deleting call data:", error);
        }
    }

    async makeInboundCall(params: {
        callConfig: CallConfig;
        botId: string;
        userId: string;
        tools: any[];
        supabase: SupabaseClient;
        env: Env;
        twilioFromNumber: string;
        temperature: number;
        callSid: string;
        transferTo?: string;
        isSingleTwilioAccount?: boolean;
    }) : Promise<{joinUrl: string}> {

        const { botId,  twilioFromNumber, userId, tools, supabase, env, temperature, transferTo, isSingleTwilioAccount, callConfig : call_config , callSid } = params;

        let account_sid = "";
        let auth_token = "";
        if(!botId || !twilioFromNumber || !userId){
            console.error("Missing parameters", botId, twilioFromNumber, userId);
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
            console.error("Bot not found", botError);
            throw new Error("Bot not found");
        }

        // Get Twilio number details
        const { data: twilioNumber, error: twilioNumberError } = await supabase
            .from('twilio_phone_numbers')
            .select('id , account_id')
            .eq('phone_number', twilioFromNumber);
        
            console.log(twilioNumber , "i am getting data from twilio_number table haha");

        if (twilioNumberError) {
            console.error("Twilio Number not found", twilioNumberError);
            throw new Error("Twilio Number not found");
        }

        // Get Twilio account details
        const { data: twilioAccount, error: twilioAccountError } = await supabase
            .from('twilio_account')
            .select('account_sid, auth_token , user_id')
            .eq('id', twilioNumber[0].account_id)
            .single();

        if (twilioAccountError) {
            console.error("Twilio Account not found for This User", twilioAccountError);
            throw new Error("Twilio Account not found for This User");
        }

        if(twilioAccount.user_id !== userId) {
            console.error("Unauthorized to use this Twilio Account");
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
                console.error("Twilio Account not found", singleTwilioAccountError);
                throw new Error("Twilio Account not found");
            }

            account_sid = singleTwilioAccount.account_sid;
            auth_token = singleTwilioAccount.auth_token;
        }

        let { voice, systemPrompt: system_prompt } = call_config || {};

        if(!voice || !system_prompt){
            console.log("Bot not found not a problem");
            voice = bot.voice;
            system_prompt = bot.system_prompt;
        }

        if(transferTo){
            tools.push({
                toolName: "transferCall",
            });
        }

        const callConfig : CallConfig = {
            voice,
            systemPrompt: system_prompt,
            temperature,
            selectedTools: tools,
            recordingEnabled: true,
            joinTimeout: "30s",
            medium: {
                twilio: {
                }
            },
            //@ts-ignore
            metadata: {
                bot_id: botId,
                user_id: userId
            }
        }

        const ultravoxResponse = await fetch('https://api.ultravox.ai/api/calls', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': env.ULTRAVOX_API_KEY,
            },
            body: JSON.stringify(callConfig),
        });

        if (!ultravoxResponse.ok) {
            console.error("Ultravox API error", ultravoxResponse);
            throw new Error("Ultravox API error" , {
                cause: await ultravoxResponse.text()
            });
        }

        const ultravoxData: JoinUrlResponse = await ultravoxResponse.json();
        const { joinUrl , callId: ultravoxCallId } = ultravoxData;

        let additional_data_to_store_in_call_records: {
            placeholders?: Record<string, string>;
            transferTo?: string;
            isSingleTwilioAccount?: boolean;
        } = {};

        // if(placeholders) {
        //     additional_data_to_store_in_call_records.placeholders = placeholders;
        // }

        if(transferTo) {
            additional_data_to_store_in_call_records.transferTo = transferTo;
        }

        if(isSingleTwilioAccount) {
            additional_data_to_store_in_call_records.isSingleTwilioAccount = isSingleTwilioAccount;
        }

        const { data: pushedCallToCallRecords , error: errorPushedCallToCallRecords } = await supabase
            .from('call_records')
            .insert([
                {
                    call_id: ultravoxCallId,
                    bot_id: botId,
                    user_id: userId,
                    additional_data: additional_data_to_store_in_call_records,
                }
            ])
            .select()

        if(errorPushedCallToCallRecords){
            throw new Error("Failed to push call to call records" , {
                cause: errorPushedCallToCallRecords
            });
        }

        //create kv
        await this.storeCallData(ultravoxCallId , {
            config: callConfig,
            twilioResponseData: {
                sid: callSid,
                ultravox_call_id: ultravoxCallId,
                bot_id: botId,
                user_id: userId,
                from_number: twilioFromNumber,
                to_number: "inbound",
                created_at: new Date().toISOString(),
                status: "initiated",
                account_sid: account_sid,
                phone_number_sid: twilioNumber[0].id,
                to: "inbound",
                to_formatted: "inbound"
            },
            joinUrlResponse: ultravoxData,
            twilioData: {
                auth_token,
                account_sid,
                from_phone_number: twilioFromNumber,
                to_number: "inbound",
                user_id: userId,
            },
            transferTo: transferTo
        });

        return {
            joinUrl: ultravoxData.joinUrl
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
        configureBots?: boolean;
    }) {
        const { botId, toNumber, twilioFromNumber, userId, placeholders, tools, supabase, env, transferTo, isSingleTwilioAccount, callConfig : call_config, configureBots } = params;

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
                if(typeof tool === 'object' && tool !== null){
                    return tool as ToolItem;
                }
                if (typeof tool === 'object' && tool !== null && tool.toolName) {
                    return tool as ToolItem;
                }
                if (typeof tool === 'string') {
                    return { toolId: tool } as ToolItem;
                }
                return null;
            }).filter(Boolean) as ToolItem[]; 
        }

        if(configureBots){
            const tools = await this.configureBotTools(botId , userId , supabase);
            processedTools.push(...tools);
        }

        let callConfig: CallConfig = {
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
            ],
            //@ts-ignore
            firstSpeaker: "FIRST_SPEAKER_AGENT",
            metadata: {
                botId,
                userId,
                bot_id: botId,
                user_id: userId,
            },
            experimentalSettings: {
                backSeatDriver: true,
                model: "o4-mini",
                enableFunctionInsertion: true,
            }
        };

        if(!callConfig.metadata){
            callConfig.metadata = {};
        }

        if(call_config?.metadata?.job_id){
            callConfig.metadata.job_id = call_config.metadata.job_id;
        }

        if(call_config?.metadata?.contact_id){
            callConfig.metadata.contact_id = call_config.metadata.contact_id;
        }

        if(call_config?.metadata?.campaign_id){
            callConfig.metadata.campaign_id = call_config.metadata.campaign_id;
        }

        if(!callConfig.selectedTools?.some((tool: any) => tool.toolName === "hangUp")) {
            callConfig.selectedTools?.push({
                toolName: "hangUp"
            });
        }

        if(!callConfig.selectedTools?.some((tool: any) => tool.toolName === "leaveVoicemail")) {
            callConfig.selectedTools?.push({
                toolName: "leaveVoicemail"
            });
        }

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

            if(ultravoxResponse.status === 429){
                throw new Error("concurency limit");
            }

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
                MachineDetection: 'DetectMessageEnd',
                AsyncAmd: 'true',
                AsyncAmdStatusCallback: 'https://fc3b-183-83-227-251.ngrok-free.app/api/async-amd-status',
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
            status: twilioData.status,
            callId: ultravoxCallId
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
        const twiml = new VoiceResponse();
        twiml.dial().number(transferTo as string);

        const UpdatedCall = await client.calls(twilioResponseData.sid).update({
            twiml: twiml.toString()
        });

        console.log("UpdatedCall: ", UpdatedCall);

        this.deleteCallData(callId);

        return {
            callId,
            transferReason,
            urgencyLevel,
            status: 'transferring'
        };
    }

    async voiceMailDetector(callSid: string, twilioSid: string) {
        const call = await this.getCallDataByTwilioCallSid(callSid);
        if (!call) {
            console.error("Call not found:", callSid , twilioSid);
            throw new Error('Call not found');
        }

        try{

        const { config: callConfig, twilioData, joinUrlResponse, twilioResponseData } = call;

        if(twilioSid !== twilioData.account_sid) {
            console.error("Invalid account , account sids are not matching", callSid);
            throw new Error('Invalid account , account sids are not matching');
        }

        console.log("UpdatedCall: --> updating the text npo erors till now");

        const client = twilio(twilioData.account_sid, twilioData.auth_token);
        const twiml = new VoiceResponse();
        twiml.pause({ length: 1 });
        twiml.say("we have detected a voicemail, you call callback on the same number for further assistance");
        twiml.hangup();

        console.log("UpdatedCall: --> hehe");

        const UpdatedCall = await client.calls(twilioResponseData.sid).update({
            twiml: twiml.toString()
        });

        return {
            callSid,
            status: 'transferring'
        };

        this.deleteCallData(callSid);

        }catch(error){
            console.error("Error transferring call:", error);
            throw new Error('Failed to transfer call');
        }

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

    private async configureBotTools(botId: string, userId: string, supabase: SupabaseClient): Promise<SelectedTool[]> {
        try{
            const { data : bot, error: errorBots } = await supabase
            .from('bots')
            .select('*')
            .eq('id', botId)
            .eq('user_id', userId)
            .single() as {
                data: {
                    id: string;
                    phone_number: string;
                    voice: string;
                    system_prompt: string;
                    user_id: any[];
                    created_at: string;
                    name: string;
                    is_appointment_booking_allowed: string;
                    appointment_tool_id: string;
                    knowledge_base_id: string;
                };
                error: any;
            };
            // bot data type

            if(errorBots){
                throw new Error('Failed to fetch bots');
            }

            const tools: SelectedTool[] = [];

            if(bot.is_appointment_booking_allowed){
                const appointmentTools = await this.configureAppointmentTool(bot.appointment_tool_id, botId, userId, supabase);
                tools.push(...appointmentTools);
            }

            if(bot.knowledge_base_id){
                tools.push({
                    toolName: "queryCorpus",
                    parameterOverrides: {
                        corpus_id: bot.knowledge_base_id,
                        max_results: 5,
                    }
                })
            };

            return tools;
        }
        catch(error){
            console.error("Error configuring bot tools:", error);
            return [];
        }
    }

    private async configureAppointmentTool(appointmentToolId: string, botId: string, userId: string, supabase: SupabaseClient): Promise<any[]> {
        try{
            const tools: SelectedTool[] = [];

            const { data : appointmentData, error: errorAppointmentTool } = await supabase
            .from('appointment_tools')
            .select('*')
            .eq('id', appointmentToolId) as {
                data: {
                    id: string;
                    description: string;
                    calendar_account_id: string;
                    business_hours: string;
                    appointment_duration: number;
                    appointment_types: string[];
                    calendar_email: string;
                    prompt_template: string;
                    is_calcom: boolean;

                }[];
                error: any;
            }

            if(!appointmentData || appointmentData.length === 0 || errorAppointmentTool){
                throw new Error('Failed to fetch appointment tool');
            }

            const appointmentToolDetails = appointmentData.find((appointment) => appointment.id === appointmentToolId);

            if(!appointmentToolDetails){
                throw new Error('Failed to fetch (found) appointment tool');
            }

            //if calcom is true book the appointment using calcom else use the calendar account
            if(appointmentToolDetails.is_calcom) {
                const {data:calcomData, error:errorCalcomData} = await supabase
                .from('user_calcom_accounts')
                .select('*')
                .eq('user_id', userId) as {
                    data: {
                        api_key: string;
                    }[];
                    error: any;
                };

                if(!calcomData || calcomData.length === 0 || errorCalcomData){
                    throw new Error('Failed to fetch calcom data');
                }
                
                const appointmentTypes = (await this.getAppointmentTypes(appointmentToolDetails)).appointmentTypes;


                console.log("the appointment types for the calcom are "+appointmentTypes.map(type => `${type.title}: ${type.lengthInMinutes} minutes`).join('\n- '))
                const staticParameters = [
                    {
                        name: "apiKey",
                        location: ParameterLocation.QUERY,
                        value: calcomData[0].api_key,
                    },
                    {
                        name:'appointmentToolId',
                        location: ParameterLocation.QUERY,
                        value: appointmentToolId,
                    }
                ];

                const bookingTool: SelectedTool = {
                    temporaryTool:{
                      modelToolName: "bookAppointment",
                      description: `The current date is ${new Date().toDateString().split('T')[0]} \n\nIMPORTANT: Our appointment types have specific default durations, but we can be flexible if needed.\n- ${appointmentTypes.map(type => `${type.title}: ${type.lengthInMinutes} minutes`).join('\n- ')}\n\nIf a caller specifically requests a different duration, you should accommodate their request when possible. Always confirm the appointment type AND duration with the caller before booking.\n\nCRITICAL RESPONSE VALIDATION INSTRUCTIONS:\n1. After calling bookAppointment, carefully check the response:\n   - Look for "success": true in the response\n   - Verify the response contains appointment details\n   - Check for any error messages\n   - Only proceed if the response indicates a successful booking\n\n2. For successful bookings (when response has success: true):\n   - Immediately confirm the booking to the user\n   - Share the appointment details (date, time, type)\n   - Do NOT mention any technical details or API responses\n   - Do NOT ask for additional confirmation\n   - Do NOT retry the booking\n\n3. For failed bookings:\n   - Check the specific error message\n   - Handle common errors (past date, timezone, etc.)\n   - Only retry if the error is recoverable\n   - After 2 failed attempts, suggest trying again later\n\n4. NEVER:\n   - Ignore a successful response\n   - Retry after a successful booking\n   - Show technical error messages to the user\n   - Ask for confirmation after a successful booking\n   - Mention API responses or technical details\n\n5. Example successful response handling:\n   If response is: { "success": true, "appointment": { ... } }\n   Say: "Perfect! I've booked your appointment for [date] at [time]."\n\n6. Example error handling:\n   If response has error: "Cannot book appointments in the past"\n   Say: "I'm sorry, but that date has already passed. Could you choose a future date?"\n\n7. Response Validation Steps:\n   a. Check success status first\n   b. If success is true, confirm booking immediately\n   c. If success is false, check error message\n   d. Handle error appropriately\n   e. Only retry if error is recoverable\n   f. After 2 failures, suggest trying again later\n\n8. Success Confirmation Format:\n   ✓ "Perfect! I've booked your [appointment type] for [date] at [time]."\n   ✓ "Great! Your appointment is confirmed for [date] at [time]."\n   ✓ "I've scheduled your [appointment type] for [date] at [time]."\n\n9. Error Response Format:\n   ✓ "I'm sorry, but [user-friendly error explanation]. Let me try again."\n   ✓ "I'm having trouble booking that time. Would you like to try a different time?"\n   ✓ "I'm unable to book the appointment right now. Please try again later."\n\n10. NEVER use these responses:\n    ❌ "The API returned an error..."\n    ❌ "Let me try booking that again..."\n    ❌ "The system is having issues..."\n    ❌ "There was a problem with the booking..."\n    ❌ Any technical error messages or API details`,
                      dynamicParameters: [
                        {
                          name: "appointmentDetails",
                          location: ParameterLocation.BODY,
                          schema: {
                            type: "object",
                            properties: {
                              appointmentType: {
                                type: "string",
                                enum: appointmentTypes.map(type => type.title.toLowerCase().replace(/\s+/g, '_')),
                              },
                              preferredDate: {
                                type: "string",
                                format: "YYYY-MM-DD",
                              },
                              preferredTime: {
                                type: "string",
                                pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$",
                              },
                              firstName: {
                                type: "string",
                              },
                              lastName: {
                                type: "string",
                              },
                              email: {
                                type: "string",
                                format: "email",
                              },
                              timezone: {
                                type: "string",
                                description: "The caller's timezone in IANA format (e.g., 'America/New_York') or common format (e.g., 'EST', 'PST')",
                              },
                              notes: {
                                type: "string",
                              },
                              appointmentDuration: {
                                type: "string",
                                description: "Duration of the appointment in minutes. Default durations by type: " + appointmentTypes.map(type => `${type.title.toLowerCase().replace(/\s+/g, '_')}: ${type.lengthInMinutes}`).join(', ') + ". Can be customized based on caller request.",
                              },
                            },
                            required: [
                              "appointmentType",
                              "preferredDate",
                              "preferredTime",
                              "firstName",
                              "lastName",
                              "email",
                              "timezone",
                              "appointmentDuration",
                            ],
                          },
                          required: true,
                        },
                      ],
                      http: {
                        baseUrlPattern: `http://localhost:3000/api/calcom-appointments/book`,
                        httpMethod: "POST",
                      },
                      staticParameters: staticParameters
                    }
                  };
            
                  console.log("✅ Successfully created cal.com appointment tool configuration");
            
                  const rescheduleTool: SelectedTool = {
                    temporaryTool: {
                      modelToolName: "rescheduleAppointment",
                      description: "To reschedule an existing appointment, you need to get the eventId first. Use the lookup tool to confirm them and get the eventId first, then call this tool with the eventId, new date, and new time.",
                      dynamicParameters: [
                        {
                          name: "eventId",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The eventId of the appointment to reschedule, obtained from the lookup endpoint." },
                          required: true
                        },
                        {
                          name: "newDate",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", format: "YYYY-MM-DD", description: "The new date for the appointment." },
                          required: true
                        },
                        {
                          name: "newTime",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", description: "The new time for the appointment." },
                          required: true
                        },
                        {
                          name: "timezone",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The timezone for the new appointment time (IANA format, e.g., 'America/New_York')." },
                          required: true
                        }
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/calcom/rescheduleAppointment`,
                        httpMethod: "POST"
                      },
                      staticParameters: staticParameters,
                    }
                  };
            
                  const cancelTool: SelectedTool = {
                    temporaryTool: {
                      modelToolName: "cancelAppointment",
                      description: "Cancel an existing appointment. Always ask for the user's name, email, the slot they booked (date, time, and timezone). Use the /api/appointments/lookup endpoint to get the eventId first, then call this tool with the eventId.",
                      dynamicParameters: [
                        {
                          name: "eventId",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The eventId of the appointment to cancel, obtained from the lookup endpoint." },
                          required: true
                        }
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/calcom/cancelAppointment`,
                        httpMethod: "POST"
                      },
                      staticParameters: staticParameters
                    }
                  };
            
                  const lookupTool: SelectedTool = {
                    temporaryTool: {
                      modelToolName: "lookupAppointment",
                      description: "Look up an existing appointment in Cal.com. Always use this tool first to confirm the user's appointment details and obtain the eventId before attempting to cancel or reschedule. Provide the user's name, email, the slot they booked (date, time, and timezone). remeber the present date is " + new Date().toDateString().split('T')[0] + " and the present time is " + new Date().toLocaleTimeString(),
                      dynamicParameters: [
                        {
                          name: "name",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The name used to book the appointment." },
                          required: true
                        },
                        {
                          name: "email",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", format: "email", description: "The email used to book the appointment." },
                          required: true
                        },
                        {
                          name: "date",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", format: "YYYY-MM-DD", description: "The appointment date." },
                          required: true
                        },
                        {
                          name: "time",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", description: "The appointment time." },
                          required: true
                        },
                        {
                          name: "timezone",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The timezone the appointment was booked in (IANA format, e.g., 'America/New_York')." },
                          required: true
                        },
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/calcom/lookupAppointment`,
                        httpMethod: "POST"
                      },
                      staticParameters: staticParameters
                    }
                  };
    
                  tools.push(bookingTool);
                  tools.push(rescheduleTool);
                  tools.push(cancelTool);
                  tools.push(lookupTool);
    
                  return tools;


            } else {
                const calendarAccount = await this.getUserCalendarAccount(userId, supabase);

                if(!calendarAccount){
                    throw new Error('Failed to fetch user calendar account');
                }
    
                const appointmentTool = appointmentData.find((appointment) => appointment.id === appointmentToolId);
    
                if(!appointmentTool){
                    throw new Error('Failed to fetch (found) appointment tool');
                }
    
                const actualCalendar = await this.getCallendarById(appointmentTool?.calendar_account_id, supabase);
    
                const { access_token, refresh_token, calendar_email, expires_at } = actualCalendar[0];
    
                if(!access_token || !refresh_token || !calendar_email || !expires_at){
                    throw new Error('Failed to fetch calendar account');
                }
    
                const appointmentTypes = (await this.getAppointmentTypes(appointmentTool)).appointmentTypes;
    
                const staticParameters = [
                    {
                        name: "access_token",
                        location: ParameterLocation.QUERY,
                        value: access_token || "not_found",
                    },
                    {
                        name: "refresh_token",
                        location: ParameterLocation.QUERY,
                        value: refresh_token || "not_found",
                    },
                    {
                        name: "calendar_id",
                        location: ParameterLocation.QUERY,
                        value: appointmentTool?.calendar_account_id || "",
                    }
                ]
    
                const bookingTool: SelectedTool = {
                    temporaryTool:{
                      modelToolName: "bookAppointment",
                      description: `The current date is ${new Date().toDateString().split('T')[0]} \n\nIMPORTANT: Our appointment types have specific default durations, but we can be flexible if needed.\n- ${appointmentTypes.map(type => `${type.name}: ${type.duration} minutes`).join('\n- ')}\n\nIf a caller specifically requests a different duration, you should accommodate their request when possible. Always confirm the appointment type AND duration with the caller before booking.\n\nCRITICAL RESPONSE VALIDATION INSTRUCTIONS:\n1. After calling bookAppointment, carefully check the response:\n   - Look for "success": true in the response\n   - Verify the response contains appointment details\n   - Check for any error messages\n   - Only proceed if the response indicates a successful booking\n\n2. For successful bookings (when response has success: true):\n   - Immediately confirm the booking to the user\n   - Share the appointment details (date, time, type)\n   - Do NOT mention any technical details or API responses\n   - Do NOT ask for additional confirmation\n   - Do NOT retry the booking\n\n3. For failed bookings:\n   - Check the specific error message\n   - Handle common errors (past date, timezone, etc.)\n   - Only retry if the error is recoverable\n   - After 2 failed attempts, suggest trying again later\n\n4. NEVER:\n   - Ignore a successful response\n   - Retry after a successful booking\n   - Show technical error messages to the user\n   - Ask for confirmation after a successful booking\n   - Mention API responses or technical details\n\n5. Example successful response handling:\n   If response is: { "success": true, "appointment": { ... } }\n   Say: "Perfect! I've booked your appointment for [date] at [time]."\n\n6. Example error handling:\n   If response has error: "Cannot book appointments in the past"\n   Say: "I'm sorry, but that date has already passed. Could you choose a future date?"\n\n7. Response Validation Steps:\n   a. Check success status first\n   b. If success is true, confirm booking immediately\n   c. If success is false, check error message\n   d. Handle error appropriately\n   e. Only retry if error is recoverable\n   f. After 2 failures, suggest trying again later\n\n8. Success Confirmation Format:\n   ✓ "Perfect! I've booked your [appointment type] for [date] at [time]."\n   ✓ "Great! Your appointment is confirmed for [date] at [time]."\n   ✓ "I've scheduled your [appointment type] for [date] at [time]."\n\n9. Error Response Format:\n   ✓ "I'm sorry, but [user-friendly error explanation]. Let me try again."\n   ✓ "I'm having trouble booking that time. Would you like to try a different time?"\n   ✓ "I'm unable to book the appointment right now. Please try again later."\n\n10. NEVER use these responses:\n    ❌ "The API returned an error..."\n    ❌ "Let me try booking that again..."\n    ❌ "The system is having issues..."\n    ❌ "There was a problem with the booking..."\n    ❌ Any technical error messages or API details`,
                      dynamicParameters: [
                        {
                          name: "appointmentDetails",
                          location: ParameterLocation.BODY,
                          schema: {
                            type: "object",
                            properties: {
                              appointmentType: {
                                type: "string",
                                enum: appointmentTypes.map(type => type.name.toLowerCase().replace(/\s+/g, '_')),
                              },
                              preferredDate: {
                                type: "string",
                                format: "YYYY-MM-DD",
                              },
                              preferredTime: {
                                type: "string",
                                pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$",
                              },
                              firstName: {
                                type: "string",
                              },
                              lastName: {
                                type: "string",
                              },
                              email: {
                                type: "string",
                                format: "email",
                              },
                              timezone: {
                                type: "string",
                                description: "The caller's timezone in IANA format (e.g., 'America/New_York') or common format (e.g., 'EST', 'PST')",
                              },
                              notes: {
                                type: "string",
                              },
                              appointmentDuration: {
                                type: "string",
                                description: "Duration of the appointment in minutes. Default durations by type: " + appointmentTypes.map(type => `${type.name.toLowerCase().replace(/\s+/g, '_')}: ${type.duration}`).join(', ') + ". Can be customized based on caller request.",
                              },
                            },
                            required: [
                              "appointmentType",
                              "preferredDate",
                              "preferredTime",
                              "firstName",
                              "lastName",
                              "email",
                              "timezone",
                              "appointmentDuration",
                            ],
                          },
                          required: true,
                        },
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/bookAppointment`,
                        httpMethod: "POST",
                      },
                      staticParameters: staticParameters
                    }
                  };
            
                  console.log("✅ Successfully created appointment tool configuration");
            
                  const rescheduleTool: SelectedTool = {
                    temporaryTool: {
                      modelToolName: "rescheduleAppointment",
                      description: "To reschedule an existing appointment, you need to get the eventId first. Use the lookup tool to confirm them and get the eventId first, then call this tool with the eventId, new date, and new time.",
                      dynamicParameters: [
                        {
                          name: "eventId",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The eventId of the appointment to reschedule, obtained from the lookup endpoint." },
                          required: true
                        },
                        {
                          name: "newDate",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", format: "YYYY-MM-DD", description: "The new date for the appointment." },
                          required: true
                        },
                        {
                          name: "newTime",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", description: "The new time for the appointment." },
                          required: true
                        },
                        {
                          name: "timezone",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The timezone for the new appointment time (IANA format, e.g., 'America/New_York')." },
                          required: true
                        }
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/appointments/reschedule`,
                        httpMethod: "POST"
                      },
                      staticParameters: staticParameters,
                    }
                  };
            
                  const cancelTool: SelectedTool = {
                    temporaryTool: {
                      modelToolName: "cancelAppointment",
                      description: "Cancel an existing appointment. Always ask for the user's name, email, the slot they booked (date, time, and timezone). Use the /api/appointments/lookup endpoint to get the eventId first, then call this tool with the eventId.",
                      dynamicParameters: [
                        {
                          name: "eventId",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The eventId of the appointment to cancel, obtained from the lookup endpoint." },
                          required: true
                        }
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/appointments/cancel`,
                        httpMethod: "POST"
                      },
                      staticParameters: staticParameters
                    }
                  };
            
                  const lookupTool: SelectedTool = {
                    temporaryTool: {
                      modelToolName: "lookupAppointment",
                      description: "Look up an existing appointment in Google Calendar. Always use this tool first to confirm the user's appointment details and obtain the eventId before attempting to cancel or reschedule. Provide the user's name, email, the slot they booked (date, time, and timezone), and their Google Calendar access token. remeber the present date is " + new Date().toDateString().split('T')[0] + " and the present time is " + new Date().toLocaleTimeString(),
                      dynamicParameters: [
                        {
                          name: "name",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The name used to book the appointment." },
                          required: true
                        },
                        {
                          name: "email",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", format: "email", description: "The email used to book the appointment." },
                          required: true
                        },
                        {
                          name: "date",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", format: "YYYY-MM-DD", description: "The appointment date." },
                          required: true
                        },
                        {
                          name: "time",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", description: "The appointment time." },
                          required: true
                        },
                        {
                          name: "timezone",
                          location: ParameterLocation.BODY,
                          schema: { type: "string", description: "The timezone the appointment was booked in (IANA format, e.g., 'America/New_York')." },
                          required: true
                        },
                      ],
                      http: {
                        baseUrlPattern: `https://app.magicteams.ai/api/appointments/lookup`,
                        httpMethod: "POST"
                      },
                      staticParameters: staticParameters
                    }
                  };
    
                  tools.push(bookingTool);
                  tools.push(rescheduleTool);
                  tools.push(cancelTool);
                  tools.push(lookupTool);
    
                  return tools;
            }
        }
        catch(error){
            console.error("Error configuring appointment tool:", error);
            return [];
        }
    }

    private async getUserCalendarAccount(userId: string, supabase: SupabaseClient): Promise<any[]> {
        try{
            const { data , error: errorUserCalendarAccount } = await supabase
            .from('user_calendar_accounts')
            .select('*')
            .eq('user_id', userId);

            if(!data || data.length === 0 || errorUserCalendarAccount){
                throw new Error('Failed to fetch user calendar account');
            }
          
            const account = data.find((account) => account.user_id === userId);

            return account;

        }
        catch(error){
            console.error("Error fetching user calendar account:", error);
            return [];
        }
    }

    private async getCallendarById(calendarId: string, supabase: SupabaseClient): Promise<any[]> {
        try{
            const { data, error: errorCalendar } = await supabase
            .from('user_calendar_accounts')
            .select('*')
            .eq('id', calendarId);

            if(!data || data.length === 0 || errorCalendar){
                throw new Error('Failed to fetch calendar');
            }

            return data;
        }
        catch(error){
            console.error("Error fetching calendar:", error);
            return [];
        }
    }

    private async getAppointmentTypes(appointmentTool: any): Promise<{appointmentTypes: {name: string, duration: number}[]}> {
        try {
            let appointmentTypes: {name: string, duration: number}[] = [];

            if ((appointmentTool as any).appointment_types) {
              // Handle string parsing if needed (depending on how it's stored)
              if (typeof (appointmentTool as any).appointment_types === 'string') {
                appointmentTypes = JSON.parse((appointmentTool as any).appointment_types);
              } else {
                appointmentTypes = (appointmentTool as any).appointment_types;
              }
              console.log(`Found ${appointmentTypes.length} appointment types in tool configuration`);
              
              return {appointmentTypes};

            } else {
              console.warn("No appointment types found in tool configuration, using defaults");
              appointmentTypes = [
                { name: "consultation", duration: 60 },
                { name: "follow_up", duration: 30 },
                { name: "general", duration: 45 }
              ];

              return {
                appointmentTypes,
              };
            }
          } catch (error) {
            console.error("Error parsing appointment types:", error);
            return {
                appointmentTypes: [
                    { name: "consultation", duration: 60 },
                    { name: "follow_up", duration: 30 },
                    { name: "general", duration: 45 }
                  ],
            };
        }
    }

    private async configureKnowledgeBase(knowledgeBaseId: string, botId: string, userId: string, supabase: SupabaseClient): Promise<any[]> {
        return [];
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