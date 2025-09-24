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
    numberLockingEnabled?: boolean;
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

enum KnownParamEnum {
    UNSPECIFIED = "KNOWN_PARAM_UNSPECIFIED",
    CALL_ID = "KNOWN_PARAM_CALL_ID",
    CONVERSATION_HISTORY = "KNOWN_PARAM_CONVERSATION_HISTORY",
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

    // Helper function to ensure consistent number normalization for locking
    private normalizeNumberForLocking(phoneNumber: string): string {
        return phoneNumber.replaceAll("+", "").replaceAll(" ", "").replaceAll("-", "");
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
            transferTo: transferTo,
            numberLockingEnabled: false // Inbound calls don't need locking
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
        twilioFromNumbers?: string[]; // Array of available numbers
        userId: string;
        placeholders?: Record<string, string>;
        tools: string[];
        supabase: SupabaseClient;
        env: Env;
        transferTo?: string;
        isSingleTwilioAccount?: boolean;
        configureBots?: boolean;
        enableNumberLocking?: boolean;
    }) {
        const { botId, toNumber, twilioFromNumber, twilioFromNumbers, userId, placeholders, tools, supabase, env, isSingleTwilioAccount, callConfig : call_config, configureBots, enableNumberLocking } = params;
        let transferTo = params.transferTo;
        console.log("calling ", toNumber  ,"with locking" , twilioFromNumber , twilioFromNumbers, enableNumberLocking);
        
        let account_sid = "";
        let auth_token = "";
        let selectedTwilioNumber = twilioFromNumber;
        
        if(!botId || !toNumber || !userId){
            throw new Error("Missing parameters");
        }

        // If number locking is enabled and we have multiple numbers, find an available one
        if (enableNumberLocking && twilioFromNumbers && twilioFromNumbers.length > 0) {
            let availableNumber = null;
            
            // Get customer timezone and sort numbers by proximity
            let orderedNumbers = twilioFromNumbers;
            try {
                const customerTimezone = await this.getCustomerTimezone(toNumber);
                orderedNumbers = await this.sortNumbersByTimezoneProximity(twilioFromNumbers, customerTimezone, supabase);
                console.log(`📍 Customer timezone: ${customerTimezone}, ordered numbers by proximity:`, orderedNumbers);
            } catch (error) {
                console.log(`⚠️  Could not determine customer timezone, using randomized order:`, error);
                // Fallback to randomization if timezone detection fails
                orderedNumbers = [...twilioFromNumbers].sort(() => Math.random() - 0.5);
            }
            
            // Try each Twilio number with atomic check-and-lock to prevent race conditions
            for (const rawNumber of orderedNumbers) {
                // Normalize number for locking (remove formatting)
                const normalizedNumber = this.normalizeNumberForLocking(rawNumber);
                const twilioLockKey = `locked_twilio:${normalizedNumber}`;
                
                // Check if number is locked
                const isTwilioLocked = await env.ACTIVE_CALLS.get(twilioLockKey);
                
                if (!isTwilioLocked) {
                    // Try to lock it immediately with a unique identifier to detect conflicts
                    const lockId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                    await env.ACTIVE_CALLS.put(twilioLockKey, lockId, { expirationTtl: 120 }); // 10 minutes max lock time
                    
                    // Wait a small amount to let any concurrent operations complete
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Verify we still have the lock (check for race condition)
                    const currentLock = await env.ACTIVE_CALLS.get(twilioLockKey);
                    
                    if (currentLock === lockId) {
                        // We successfully have the lock - use original formatted number for DB lookup
                        availableNumber = rawNumber;
                        console.log(`🔒 SUCCESSFULLY LOCKED Twilio number: ${normalizedNumber} with ID: ${lockId} (key: ${twilioLockKey})`);
                        break;
                    } else {
                        // Someone else got the lock, try next number
                        console.log(`⚠️  Lost race condition for number ${normalizedNumber}, trying next...`);
                        continue;
                    }
                } else {
                    console.log(`⚠️  Number ${normalizedNumber} already locked: ${isTwilioLocked}`);

                    // Debug lock age
                    const lockParts = isTwilioLocked.split('_');
                    if (lockParts.length === 2) {
                        const lockTimestamp = parseInt(lockParts[0]);
                        const currentTime = Date.now();
                        const lockAge = currentTime - lockTimestamp;
                        console.log(`🕐 Lock age: ${Math.floor(lockAge/1000)}s (created at: ${new Date(lockTimestamp).toISOString()})`);
                        console.log(`🕐 Current time: ${new Date(currentTime).toISOString()}`);
                        console.log(`🕐 Lock will expire in: ${Math.floor((10*60*1000 - lockAge)/1000)}s`);
                    }

                    // Check if this is a stale lock (older than 10 minutes)
                    try {
                        const lockParts = isTwilioLocked.split('_');
                        if (lockParts.length === 2) {
                            const lockTimestamp = parseInt(lockParts[0]);
                            const currentTime = Date.now();
                            const lockAge = currentTime - lockTimestamp;
                            const maxLockAge = 2 * 60 * 1000; // 2 minutes (reduced for faster recovery)

                            if (lockAge > maxLockAge) {
                                console.log(`🧹 Clearing stale lock for ${normalizedNumber} (age: ${Math.floor(lockAge/1000)}s)`);
                                await env.ACTIVE_CALLS.delete(twilioLockKey);

                                // Now try to lock it again
                                const newLockId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                                await env.ACTIVE_CALLS.put(twilioLockKey, newLockId, { expirationTtl: 120 });

                                // Wait and verify
                                await new Promise(resolve => setTimeout(resolve, 50));
                                const currentLock = await env.ACTIVE_CALLS.get(twilioLockKey);

                                if (currentLock === newLockId) {
                                    availableNumber = rawNumber;
                                    console.log(`✅ Successfully cleared stale lock and re-locked: ${normalizedNumber}`);
                                    break;
                                }
                            }
                        }
                    } catch (staleLockError) {
                        console.log(`❌ Error checking stale lock: ${staleLockError}`);
                    }
                }
            }
            
            if (!availableNumber) {
                // All numbers are busy, throw error for retry
                console.log(`🚫 All ${twilioFromNumbers.length} Twilio numbers are busy`);
                throw new Error(`TWILIO_BUSY:ALL_NUMBERS_BUSY`);
            }
            
            selectedTwilioNumber = availableNumber;
        } else if (enableNumberLocking) {
            // Single number locking (backward compatibility)
            if (!twilioFromNumber) {
                throw new Error("Missing twilioFromNumber parameter");
            }
            
            // Normalize number for locking (remove formatting) - SAME as in the loop above
            const normalizedTwilioNumber = this.normalizeNumberForLocking(twilioFromNumber);
            const twilioLockKey = `locked_twilio:${normalizedTwilioNumber}`;
            const isTwilioLocked = await env.ACTIVE_CALLS.get(twilioLockKey);

            if (isTwilioLocked) {
                console.log(`⚠️  Single number ${normalizedTwilioNumber} already locked: ${isTwilioLocked}`);

                // Check if this is a stale lock (older than 10 minutes)
                try {
                    const lockParts = isTwilioLocked.split('_');
                    if (lockParts.length === 2) {
                        const lockTimestamp = parseInt(lockParts[0]);
                        const currentTime = Date.now();
                        const lockAge = currentTime - lockTimestamp;
                        const maxLockAge = 2 * 60 * 1000; // 2 minutes (reduced for faster recovery)

                        if (lockAge > maxLockAge) {
                            console.log(`🧹 Clearing stale single number lock for ${normalizedTwilioNumber} (age: ${Math.floor(lockAge/1000)}s)`);
                            await env.ACTIVE_CALLS.delete(twilioLockKey);
                            console.log(`✅ Cleared stale lock, proceeding with call`);
                        } else {
                            throw new Error(`TWILIO_BUSY:${twilioFromNumber}`);
                        }
                    } else {
                        throw new Error(`TWILIO_BUSY:${twilioFromNumber}`);
                    }
                } catch (staleLockError) {
                    console.log(`❌ Error checking stale single number lock: ${staleLockError}`);
                    throw new Error(`TWILIO_BUSY:${twilioFromNumber}`);
                }
            }

            // Lock the Twilio FROM number before making the call
            const singleLockId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            await env.ACTIVE_CALLS.put(twilioLockKey, singleLockId, { expirationTtl: 120 }); // 10 minutes expiration

            console.log(`🔒 SUCCESSFULLY LOCKED single Twilio number: ${twilioFromNumber} (normalized: ${normalizedTwilioNumber}) with ID: ${singleLockId} (key: ${twilioLockKey})`);
        } else {
            // No locking, use provided number
            if (!twilioFromNumber) {
                throw new Error("Missing twilioFromNumber parameter");
            }
            selectedTwilioNumber = twilioFromNumber;
        }

        // Get bot details including realtime capture settings
            const { data: bot, error: botError } = await supabase
                .from('bots')
                .select('voice, system_prompt , is_call_transfer_allowed , call_transfer_number, is_realtime_capture_enabled, realtime_capture_fields , first_speaker')
                .eq('id', botId)
                .eq('user_id', userId)
                .single();

            if (botError) {
                throw new Error("Bot not found");
            }
        // Get Twilio number details using the selected number
        console.log(`🔍 Looking up Twilio number in database: "${selectedTwilioNumber}"`);
        
        const { data: twilioNumber, error: twilioNumberError } = await supabase
            .from('twilio_phone_numbers')
            .select('id , account_id, phone_number')
            .eq('phone_number', selectedTwilioNumber);
        
        console.log("🔍 Database lookup result:", { twilioNumber, twilioNumberError });

        if (twilioNumberError) {
            console.error("❌ Database error looking up Twilio number:", twilioNumberError);
            throw new Error("Twilio Number not found");
        }

        if (!twilioNumber || twilioNumber.length === 0) {
            // Try to find all numbers in the database to debug formatting differences
            const { data: allNumbers } = await supabase
                .from('twilio_phone_numbers')
                .select('phone_number')
                .limit(10);
            
            console.error(`❌ No Twilio number found for: "${selectedTwilioNumber}"`);
            console.error("📋 Available numbers in database:", allNumbers?.map(n => `"${n.phone_number}"`));
            
            throw new Error(`Twilio Number not found in database: ${selectedTwilioNumber}`);
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
            firstSpeaker: bot.first_speaker,
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

        // Add realtime capture tool if bot has it enabled
        if (bot.is_realtime_capture_enabled && bot.realtime_capture_fields) {
            const realtimeCaptureFields = bot.realtime_capture_fields as any[];
            
            // Generate dynamic parameters for the captureOutcome tool
            const dynamicParameters = realtimeCaptureFields.map(field => ({
                name: field.name,
                location: ParameterLocation.BODY,
                schema: field.type === 'text' 
                    ? { type: "string", description: field.description }
                    : field.type === 'number'
                    ? { type: "number", description: field.description }
                    : field.type === 'boolean'
                    ? { type: "boolean", description: field.description }
                    : field.type === 'enum'
                    ? { type: "string", enum: field.enum_values, description: field.description }
                    : { type: "string", description: field.description },
                required: field.required
            }));

            const captureOutcomeTool: SelectedTool = {
                temporaryTool: {
                    modelToolName: "captureOutcome",
                    description: "Capture data in real-time during conversation based on configured fields",
                    dynamicParameters: dynamicParameters,
                    automaticParameters: [
                        {
                            name: "callId",
                            location: ParameterLocation.BODY,
                            knownValue: KnownParamEnum.CALL_ID,
                        }
                    ],
                    http: {
                        baseUrlPattern: "https://jenny-ai-turo.everyai-com.workers.dev/api/capture-outcome",
                        httpMethod: "POST"
                    }
                }
            };

            // Add the tool to the callConfig
            if (!callConfig.selectedTools) {
                callConfig.selectedTools = [];
            }
            callConfig.selectedTools.push(captureOutcomeTool);
            
            console.log("Added realtime capture tool with fields:", realtimeCaptureFields.map(f => f.name));
        }

        if(!callConfig.metadata){
            callConfig.metadata = {};
        }

        // Preserve campaign metadata from the incoming call_config
        if(call_config?.metadata?.job_id){
            callConfig.metadata.job_id = call_config.metadata.job_id;
            console.log(`📋 Preserving job_id in metadata: ${call_config.metadata.job_id}`);
        }

        if(call_config?.metadata?.contact_id){
            callConfig.metadata.contact_id = call_config.metadata.contact_id;
            console.log(`📋 Preserving contact_id in metadata: ${call_config.metadata.contact_id}`);
        }

        if(call_config?.metadata?.campaign_id){
            callConfig.metadata.campaign_id = call_config.metadata.campaign_id;
            console.log(`📋 Preserving campaign_id in metadata: ${call_config.metadata.campaign_id}`);
        }
        
        console.log(`🔍 Final metadata being sent to Ultravox:`, JSON.stringify(callConfig.metadata));

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
            // If Ultravox call fails and number locking is enabled, unlock the Twilio FROM number
            if (enableNumberLocking) {
                const normalizedNumber = this.normalizeNumberForLocking(selectedTwilioNumber);
                const twilioLockKey = `locked_twilio:${normalizedNumber}`;
                try {
                    await env.ACTIVE_CALLS.delete(twilioLockKey);
                    console.log(`🔓 Unlocked Twilio FROM number: ${selectedTwilioNumber} (normalized: ${normalizedNumber}) due to Ultravox failure`);
                } catch (unlockError) {
                    console.error(`Error unlocking Twilio number after Ultravox failure:`, unlockError);
                }
            }

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
        }else if(bot.is_call_transfer_allowed){
            additional_data_to_store_in_call_records.transferTo = bot.call_transfer_number;
            transferTo = bot.call_transfer_number;
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

        let parse_to_number = toNumber.replaceAll('-', '');
        parse_to_number = toNumber.replaceAll(' ', '');

        // Create Twilio call
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Calls.json`;
        const twilioResponse = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(`${account_sid}:${auth_token}`)
            },
            body: new URLSearchParams({
                To: parse_to_number,
                From: selectedTwilioNumber,
                Twiml: `<Response><Connect><Stream url="${joinUrl}" /></Connect></Response>`,
                MachineDetection: 'DetectMessageEnd',
                AsyncAmd: 'true',
                AsyncAmdStatusCallback: 'https://fc3b-183-83-227-251.ngrok-free.app/api/async-amd-status',
            })
        });

        if (!twilioResponse.ok) {
            // If call fails and number locking is enabled, unlock the Twilio FROM number
            if (enableNumberLocking) {
                const normalizedNumber = this.normalizeNumberForLocking(selectedTwilioNumber);
                const twilioLockKey = `locked_twilio:${normalizedNumber}`;
                try {
                    await env.ACTIVE_CALLS.delete(twilioLockKey);
                    console.log(`🔓 Unlocked Twilio FROM number: ${selectedTwilioNumber} (normalized: ${normalizedNumber}) due to call failure`);
                } catch (unlockError) {
                    console.error(`Error unlocking Twilio number after call failure:`, unlockError);
                }
            }
            
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
                from_phone_number: selectedTwilioNumber,
                to_number: toNumber,
                user_id: userId
            },
            transferTo: transferTo,
            numberLockingEnabled: enableNumberLocking || false
        });

        return {
            from_number: selectedTwilioNumber,
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


            // Get call data from KV FIRST (before checking unjoined)
            const call = await this.getCallData(callId);
            if (!call) {
                console.error("Call not found:", callId);
                return{
                    userId: null,
                    TimeTaken: TimeTaken,
                    callId: null
                };
            }

            console.log("🔍 Retrieved call data for unlock check:", {
                callId,
                endReason: callConfig.endReason,
                numberLockingEnabled: call.numberLockingEnabled,
                twilioFromNumber: call.twilioData?.from_phone_number,
                hasEnv: !!this.env
            });

            const { twilioData: { user_id: userId, from_phone_number: twilioFromNumber, to_number: toNumber }, numberLockingEnabled } = call;

            // ALWAYS unlock the Twilio FROM number if locking was enabled (regardless of end reason)
            if (numberLockingEnabled && twilioFromNumber && this.env) {
                const normalizedNumber = this.normalizeNumberForLocking(twilioFromNumber);
                const twilioLockKey = `locked_twilio:${normalizedNumber}`;

                console.log(`🔓 ATTEMPTING TO UNLOCK: ${twilioFromNumber} (key: ${twilioLockKey})`);

                // First check what's currently in the lock
                try {
                    const currentLockValue = await this.env.ACTIVE_CALLS.get(twilioLockKey);
                    console.log(`🔍 Current lock value before delete: ${currentLockValue}`);

                    if (currentLockValue) {
                        await this.env.ACTIVE_CALLS.delete(twilioLockKey);
                        console.log(`✅ Successfully DELETED lock for Twilio number: ${twilioFromNumber} (normalized: ${normalizedNumber}) (EndReason: ${callConfig.endReason})`);

                        // Verify it's actually deleted
                        const verifyDeleted = await this.env.ACTIVE_CALLS.get(twilioLockKey);
                        if (verifyDeleted) {
                            console.error(`❌ CRITICAL: Lock still exists after delete! Value: ${verifyDeleted}`);
                        } else {
                            console.log(`✅ VERIFIED: Lock successfully removed`);
                        }
                    } else {
                        console.log(`⚠️  No lock found to delete for key: ${twilioLockKey}`);
                    }
                } catch (error) {
                    console.error(`❌ Error unlocking Twilio FROM number ${twilioFromNumber} (key: ${twilioLockKey}):`, error);
                }
            } else {
                console.log(`⚠️  Skipping unlock - numberLockingEnabled: ${numberLockingEnabled}, twilioFromNumber: ${twilioFromNumber}, hasEnv: ${!!this.env}`);
            }

            // Handle unjoined calls AFTER unlocking
            if(callConfig.endReason === 'unjoined') {
                console.log("Call ended with reason 'unjoined' - number has been unlocked");
                await this.deleteCallData(callId);
                return{
                    userId,
                    TimeTaken: 0, // No actual call time for unjoined
                    callId
                };
            }

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
                    selected_tools?: string[];
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

            // Add user's selected custom tools
            if(bot.selected_tools && bot.selected_tools.length > 0) {
                console.log("Adding selected custom tools:", bot.selected_tools);
                
                // Get tool details from database to verify ownership
                const { data: userTools, error: toolsError } = await supabase
                    .from('tools')
                    .select('tool_id, name, model_tool_name, definition')
                    .eq('user_id', userId)
                    .eq('is_active', true)
                    .in('tool_id', bot.selected_tools);

                if (toolsError) {
                    console.error("Error fetching user tools:", toolsError);
                } else if (userTools && userTools.length > 0) {
                    // Add each selected tool
                    userTools.forEach(tool => {
                        console.log("Adding tool:", tool.name, tool.tool_id);
                        tools.push({
                            toolId: tool.tool_id
                        });
                    });
                }
            }

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

            const jenny_url = "https://app.magicteams.ai";

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
                .from('user_calcom_credentials')
                .select('*')
                .eq('user_id', userId) as {
                    data: {
                        api_key: string;
                    }[];
                    error: any;
                };

                console.log("calcomData: ", calcomData);
                console.log("errorCalcomData: ", errorCalcomData);
                console.log("userId: ", userId);

                if(!calcomData || calcomData.length === 0 || errorCalcomData){
                    throw new Error('Failed to fetch calcom data');
                }
                
                const appointmentTypes = (await this.getAppointmentTypes(appointmentToolDetails)).appointmentTypes;


                console.log("the appointment types for the calcom are "+appointmentTypes.map(type => `${type.name}: ${type.duration} minutes`).join('\n- '))
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
                      timeout: "10s",
                      description: `The current date is ${new Date().toDateString().split('T')[0]} \n\nIMPORTANT: Our appointment types have specific default durations.\n- ${appointmentTypes.map(type => `${type.name}: ${type.duration} minutes`).join('\n- ')}\n\nIf a caller specifically requests a different duration, ask them to choose one from exsitning durations. Always confirm the appointment type AND duration with the caller before booking.\n\nCRITICAL RESPONSE VALIDATION INSTRUCTIONS:\n1. After calling bookAppointment, carefully check the response:\n   - Look for "success": true in the response\n   - Verify the response contains appointment details\n   - Check for any error messages\n   - Only proceed if the response indicates a successful booking\n\n2. For successful bookings (when response has success: true):\n   - Immediately confirm the booking to the user\n   - Share the appointment details (date, time, type)\n   - Do NOT mention any technical details or API responses\n   - Do NOT ask for additional confirmation\n   - Do NOT retry the booking\n\n3. For failed bookings:\n   - Check the specific error message\n   - Handle common errors (past date, timezone, etc.)\n   - Only retry if the error is recoverable\n   - After 2 failed attempts, suggest trying again later\n\n4. NEVER:\n   - Ignore a successful response\n   - Retry after a successful booking\n   - Show technical error messages to the user\n   - Ask for confirmation after a successful booking\n   - Mention API responses or technical details\n\n5. Example successful response handling:\n   If response is: { "success": true, "appointment": { ... } }\n   Say: "Perfect! I've booked your appointment for [date] at [time]."\n\n6. Example error handling:\n   If response has error: "Cannot book appointments in the past"\n   Say: "I'm sorry, but that date has already passed. Could you choose a future date?"\n\n7. Response Validation Steps:\n   a. Check success status first\n   b. If success is true, confirm booking immediately\n   c. If success is false, check error message\n   d. Handle error appropriately\n   e. Only retry if error is recoverable\n   f. After 2 failures, suggest trying again later\n\n8. Success Confirmation Format:\n   ✓ "Perfect! I've booked your [appointment type] for [date] at [time]."\n   ✓ "Great! Your appointment is confirmed for [date] at [time]."\n   ✓ "I've scheduled your [appointment type] for [date] at [time]."\n\n9. Error Response Format:\n   ✓ "I'm sorry, but [user-friendly error explanation]. Let me try again."\n   ✓ "I'm having trouble booking that time. Would you like to try a different time?"\n   ✓ "I'm unable to book the appointment right now. Please try again later."\n\n10. NEVER use these responses:\n    ❌ "The API returned an error..."\n    ❌ "Let me try booking that again..."\n    ❌ "The system is having issues..."\n    ❌ "There was a problem with the booking..."\n    ❌ Any technical error messages or API details`,
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
                                description: "The appointment type the user wants to book. Please choose one from the following list: " + appointmentTypes.map(type => `${type.name.toLowerCase().replace(/\s+/g, '_')}: ${type.duration} minutes`).join(', ') + ". ask them to choose one from this list",
                              },
                              preferredDate: {
                                type: "string",
                                format: "YYYY-MM-DD",
                                description: `The current year is ${new Date().getFullYear()}. When a user provides a date without a year, you must infer the correct year. If the provided month and day are in the future relative to the current date, use the current year. If they have already passed, use the next year.`
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
                                description: "Please convert any user-specified timezone into a valid IANA timezone format. For example, if the user says 'IST', convert it to 'Asia/Kolkata'; for 'PST', use 'America/Los_Angeles'. Return only valid IANA timezones.",
                              },
                              notes: {
                                type: "string",
                              },
                              appointmentDuration: {
                                type: "string",
                                description: "Duration of the appointment in minutes. Default durations by type: " + appointmentTypes.map(type => `${type.name.toLowerCase().replace(/\s+/g, '_')}: ${type.duration}`).join(', ') + ". ask them to choose one from this list",
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
                        baseUrlPattern: `${jenny_url}/api/calcom-appointments/book`,
                        httpMethod: "POST",
                      },
                      staticParameters: staticParameters
                    }
                  };
                  
                  console.log("✅Successfully created cal.com appointment tool configuration");
            
                //   const rescheduleTool: SelectedTool = {
                //     temporaryTool: {
                //       modelToolName: "rescheduleAppointment",
                //       description: "To reschedule an existing appointment, you need to get the eventId first. Use the lookup tool to confirm them and get the eventId first, then call this tool with the eventId, new date, and new time.",
                //       dynamicParameters: [
                //         {
                //           name: "eventId",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", description: "The eventId of the appointment to reschedule, obtained from the lookup endpoint." },
                //           required: true
                //         },
                //         {
                //           name: "newDate",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", format: "YYYY-MM-DD", description: "The new date for the appointment." },
                //           required: true
                //         },
                //         {
                //           name: "newTime",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", description: "The new time for the appointment." },
                //           required: true
                //         },
                //         {
                //           name: "timezone",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", description: "The timezone for the new appointment time (IANA format, e.g., 'America/New_York')." },
                //           required: true
                //         }
                //       ],
                //       http: {
                //         baseUrlPattern: `${jenny_url}/api/calcom-appointments/reschedule`,
                //         httpMethod: "POST"
                //       },
                //       staticParameters: staticParameters,
                //     }
                //   };
            
                //   const cancelTool: SelectedTool = {
                //     temporaryTool: {
                //       modelToolName: "cancelAppointment",
                //       description: "Cancel an existing appointment. Always ask for the user's name, email, the slot they booked (date, time, and timezone). Use the /api/appointments/lookup endpoint to get the eventId first, then call this tool with the eventId.",
                //       dynamicParameters: [
                //         {
                //           name: "eventId",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", description: "The eventId of the appointment to cancel, obtained from the lookup endpoint." },
                //           required: true
                //         }
                //       ],
                //       http: {
                //         baseUrlPattern: `https://app.magicteams.ai/api/calcom/cancelAppointment`,
                //         httpMethod: "POST"
                //       },
                //       staticParameters: staticParameters
                //     }
                //   };
            
                //   const lookupTool: SelectedTool = {
                //     temporaryTool: {
                //       modelToolName: "lookupAppointment",
                //       description: "Look up an existing appointment in Cal.com. Always use this tool first to confirm the user's appointment details and obtain the eventId before attempting to cancel or reschedule. Provide the user's name, email, the slot they booked (date, time, and timezone). remeber the present date is " + new Date().toDateString().split('T')[0] + " and the present time is " + new Date().toLocaleTimeString(),
                //       dynamicParameters: [
                //         {
                //           name: "name",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", description: "The name used to book the appointment." },
                //           required: true
                //         },
                //         {
                //           name: "email",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", format: "email", description: "The email used to book the appointment." },
                //           required: true
                //         },
                //         {
                //           name: "date",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", format: "YYYY-MM-DD", description: "The appointment date." },
                //           required: true
                //         },
                //         {
                //           name: "time",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", description: "The appointment time." },
                //           required: true
                //         },
                //         {
                //           name: "timezone",
                //           location: ParameterLocation.BODY,
                //           schema: { type: "string", description: "The timezone the appointment was booked in (IANA format, e.g., 'America/New_York')." },
                //           required: true
                //         },
                //       ],
                //       http: {
                //         baseUrlPattern: `https://app.magicteams.ai/api/calcom/lookupAppointment`,
                //         httpMethod: "POST"
                //       },
                //       staticParameters: staticParameters
                //     }
                //   };
    
                  tools.push(bookingTool);
                //   tools.push(rescheduleTool);
                //   tools.push(cancelTool);
                //   tools.push(lookupTool);
    
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
                      timeout: "10s",
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
                      timeout: "10s",
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
                      timeout: "10s",
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
                      timeout: "10s",
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

    /**
     * Get customer timezone based on phone number
     */
    private async getCustomerTimezone(phoneNumber: string): Promise<string> {
        try {
            // Extract country code from phone number
            const countryCode = this.extractCountryCode(phoneNumber);
            
            // Map country codes to primary timezones
            const countryTimezones: Record<string, string> = {
                '1': 'America/New_York',        // US/Canada (EST as default)
                '44': 'Europe/London',          // UK
                '33': 'Europe/Paris',           // France
                '49': 'Europe/Berlin',          // Germany
                '39': 'Europe/Rome',            // Italy
                '34': 'Europe/Madrid',          // Spain
                '31': 'Europe/Amsterdam',       // Netherlands
                '32': 'Europe/Brussels',        // Belgium
                '41': 'Europe/Zurich',          // Switzerland
                '43': 'Europe/Vienna',          // Austria
                '45': 'Europe/Copenhagen',      // Denmark
                '46': 'Europe/Stockholm',       // Sweden
                '47': 'Europe/Oslo',            // Norway
                '48': 'Europe/Warsaw',          // Poland
                '351': 'Europe/Lisbon',         // Portugal
                '358': 'Europe/Helsinki',       // Finland
                '91': 'Asia/Kolkata',           // India
                '86': 'Asia/Shanghai',          // China
                '81': 'Asia/Tokyo',             // Japan
                '82': 'Asia/Seoul',             // South Korea
                '61': 'Australia/Sydney',       // Australia
                '55': 'America/Sao_Paulo',     // Brazil
                '52': 'America/Mexico_City',   // Mexico
                '7': 'Europe/Moscow',           // Russia
                '90': 'Europe/Istanbul',        // Turkey
                '971': 'Asia/Dubai',            // UAE
                '966': 'Asia/Riyadh',           // Saudi Arabia
                '27': 'Africa/Johannesburg',   // South Africa
                '234': 'Africa/Lagos',          // Nigeria
                '254': 'Africa/Nairobi',        // Kenya
                '20': 'Africa/Cairo',           // Egypt
            };

            return countryTimezones[countryCode] || 'UTC';
        } catch (error) {
            console.log(`Error determining timezone for ${phoneNumber}:`, error);
            return 'UTC';
        }
    }

    /**
     * Extract country code from phone number
     */
    private extractCountryCode(phoneNumber: string): string {
        // Remove all non-digit characters
        const digits = phoneNumber.replace(/\D/g, '');
        
        // Remove leading 1 for US/Canada numbers if length > 10
        if (digits.length === 11 && digits.startsWith('1')) {
            return '1';
        }
        
        // Check for common country codes (longest first to avoid conflicts)
        const countryCodes = ['971', '966', '234', '254', '351', '358', '44', '33', '49', '39', '34', '31', '32', '41', '43', '45', '46', '47', '48', '91', '86', '81', '82', '61', '55', '52', '90', '27', '20', '1', '7'];
        
        for (const code of countryCodes) {
            if (digits.startsWith(code)) {
                return code;
            }
        }
        
        // Default to US/Canada if no country code found
        return '1';
    }

    /**
     * Sort Twilio numbers by timezone proximity to customer
     */
    private async sortNumbersByTimezoneProximity(
        twilioNumbers: string[], 
        customerTimezone: string, 
        supabase: any
    ): Promise<string[]> {
        try {
            // Get timezone information for all Twilio numbers
            const numbersWithTimezones = await Promise.all(
                twilioNumbers.map(async (number) => {
                    try {
                        // Get account and region info for the number
                        const { data: numberData } = await supabase
                            .from('twilio_phone_numbers')
                            .select(`
                                phone_number,
                                region,
                                twilio_account:account_id (
                                    account_sid,
                                    account_name,
                                    region
                                )
                            `)
                            .eq('phone_number', number)
                            .single();

                        let numberTimezone = 'UTC';
                        
                        if (numberData) {
                            // Determine timezone based on region or number prefix
                            if (numberData.region) {
                                numberTimezone = this.regionToTimezone(numberData.region);
                            } else {
                                // Fallback to extracting from phone number
                                numberTimezone = await this.getCustomerTimezone(number);
                            }
                        }

                        return {
                            number,
                            timezone: numberTimezone,
                            timezoneOffset: this.getTimezoneOffset(numberTimezone)
                        };
                    } catch (error) {
                        console.log(`Error getting timezone for number ${number}:`, error);
                        return {
                            number,
                            timezone: 'UTC',
                            timezoneOffset: 0
                        };
                    }
                })
            );

            // Get customer timezone offset
            const customerOffset = this.getTimezoneOffset(customerTimezone);

            // Sort by timezone proximity (smallest offset difference first)
            numbersWithTimezones.sort((a, b) => {
                const offsetDiffA = Math.abs(a.timezoneOffset - customerOffset);
                const offsetDiffB = Math.abs(b.timezoneOffset - customerOffset);
                return offsetDiffA - offsetDiffB;
            });

            console.log(`Sorted numbers by timezone proximity:`, numbersWithTimezones.map(n => `${n.number} (${n.timezone})`));

            return numbersWithTimezones.map(n => n.number);
        } catch (error) {
            console.log('Error sorting numbers by timezone proximity:', error);
            // Fallback to original order
            return twilioNumbers;
        }
    }

    /**
     * Map region to timezone
     */
    private regionToTimezone(region: string): string {
        const regionTimezones: Record<string, string> = {
            'us-east-1': 'America/New_York',
            'us-west-1': 'America/Los_Angeles',
            'us-west-2': 'America/Los_Angeles',
            'eu-west-1': 'Europe/Dublin',
            'eu-central-1': 'Europe/Berlin',
            'ap-southeast-1': 'Asia/Singapore',
            'ap-northeast-1': 'Asia/Tokyo',
            'ap-southeast-2': 'Australia/Sydney',
            'ca-central-1': 'America/Toronto',
        };

        return regionTimezones[region.toLowerCase()] || 'UTC';
    }

    /**
     * Get timezone offset in hours from UTC
     */
    private getTimezoneOffset(timezone: string): number {
        try {
            const now = new Date();
            const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
            const targetTime = new Date(utc.toLocaleString("en-US", {timeZone: timezone}));
            const offsetHours = (targetTime.getTime() - utc.getTime()) / (1000 * 60 * 60);
            return offsetHours;
        } catch (error) {
            console.log(`Error calculating offset for timezone ${timezone}:`, error);
            return 0; // Default to UTC
        }
    }
}