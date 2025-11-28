import { CallConfig, CallConfigWebhookResponse, JoinUrlResponse, twilioData } from "../types/repo-common-types";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Env } from "../config/env";
import twilio from 'twilio';
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { SelectedTool } from "@repo/common-types/types";
import { UltravoxAgentService } from './ultravox-agent.service';

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
    transferTo?: string;
    numberLockingEnabled?: boolean;
};

type UrgencyLevel = 'low' | 'medium' | 'high';

interface TransferCallRequest {
    transferToNumber: string; // Dynamic phone number from user
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
    private async getCallData(callId: string): Promise<CallRecord | null> {
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

    private async getCallDataByTwilioCallSid(callSid: string): Promise<CallRecord | null> {
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
        callerMetadata?: {
            caller_number?: string;
            caller_country?: string;
            caller_state?: string;
            caller_city?: string;
            caller_zip?: string;
            called_number?: string;
            called_country?: string;
            called_state?: string;
            called_city?: string;
            called_zip?: string;
        };
    }): Promise<{ joinUrl: string }> {

        const { botId, twilioFromNumber, userId, tools, supabase, env, temperature, transferTo, isSingleTwilioAccount, callConfig: call_config, callSid, callerMetadata } = params;

        let account_sid = "";
        let auth_token = "";
        if (!botId || !twilioFromNumber || !userId) {
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

        console.log(twilioNumber, "i am getting data from twilio_number table haha");

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

        if (twilioAccount.user_id !== userId) {
            console.error("Unauthorized to use this Twilio Account");
            throw new Error("Unauthorized to use this Twilio Account");
        }

        account_sid = twilioAccount.account_sid;
        auth_token = twilioAccount.auth_token;

        if (isSingleTwilioAccount) {
            const { data: singleTwilioAccount, error: singleTwilioAccountError } = await supabase
                .from('twilio_credentials')
                .select('account_sid, auth_token')
                .eq('user_id', userId)
                .single();

            if (singleTwilioAccountError) {
                console.error("Twilio Account not found", singleTwilioAccountError);
                throw new Error("Twilio Account not found");
            }

            account_sid = singleTwilioAccount.account_sid;
            auth_token = singleTwilioAccount.auth_token;
        }

        let { voice, systemPrompt: system_prompt } = call_config || {};

        if (!voice || !system_prompt) {
            console.log("Bot not found not a problem");
            voice = bot.voice;
            system_prompt = bot.system_prompt;
        }

        if (transferTo) {
            tools.push({
                toolName: "transferCall",
            });

            if (system_prompt) {
                system_prompt += `\n\nNOTE: A transfer number is already pre-configured for this call. If you need to transfer the call, simply invoke the 'transferCall' tool. You do NOT need to ask the user for the destination number. You can pass 'PRE_CONFIGURED' as the phone number argument if required.`;
            }
        }

        const metadata: Record<string, string> = {
            bot_id: botId,
            user_id: userId,
            ...(callerMetadata?.caller_number && { caller_number: callerMetadata.caller_number }),
            ...(callerMetadata?.caller_country && { caller_country: callerMetadata.caller_country }),
            ...(callerMetadata?.caller_state && { caller_state: callerMetadata.caller_state }),
            ...(callerMetadata?.caller_city && { caller_city: callerMetadata.caller_city }),
            ...(callerMetadata?.caller_zip && { caller_zip: callerMetadata.caller_zip }),
            ...(callerMetadata?.called_number && { called_number: callerMetadata.called_number }),
            ...(callerMetadata?.called_country && { called_country: callerMetadata.called_country }),
            ...(callerMetadata?.called_state && { called_state: callerMetadata.called_state }),
            ...(callerMetadata?.called_city && { called_city: callerMetadata.called_city }),
            ...(callerMetadata?.called_zip && { called_zip: callerMetadata.called_zip }),
        };

        const callConfig: CallConfig = {
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
            metadata
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
            throw new Error("Ultravox API error", {
                cause: await ultravoxResponse.text()
            });
        }

        const ultravoxData: JoinUrlResponse = await ultravoxResponse.json();
        const { joinUrl, callId: ultravoxCallId } = ultravoxData;

        let additional_data_to_store_in_call_records: {
            placeholders?: Record<string, string>;
            transferTo?: string;
            isSingleTwilioAccount?: boolean;
        } = {};

        // if(placeholders) {
        //     additional_data_to_store_in_call_records.placeholders = placeholders;
        // }

        if (transferTo) {
            additional_data_to_store_in_call_records.transferTo = transferTo;
        }

        if (isSingleTwilioAccount) {
            additional_data_to_store_in_call_records.isSingleTwilioAccount = isSingleTwilioAccount;
        }

        const { data: pushedCallToCallRecords, error: errorPushedCallToCallRecords } = await supabase
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

        if (errorPushedCallToCallRecords) {
            throw new Error("Failed to push call to call records", {
                cause: errorPushedCallToCallRecords
            });
        }

        //create kv
        await this.storeCallData(ultravoxCallId, {
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

    async makeInboundCallWithAgent(params: {
        agentId: string;
        botId: string;
        userId: string;
        callSid: string;
        twilioFromNumber: string;
        transferTo?: string;
        supabase: SupabaseClient;
        env: Env;
        knowledgeBaseId?: string;
        isRealtimeCaptureEnabled?: boolean;
        realtimeCaptureFields?: any[];
        callerMetadata?: {
            caller_number?: string;
            caller_country?: string;
            caller_state?: string;
            caller_city?: string;
            caller_zip?: string;
            called_number?: string;
            called_country?: string;
            called_state?: string;
            called_city?: string;
            called_zip?: string;
        };
    }): Promise<{ joinUrl: string }> {
        const {
            agentId,
            botId,
            userId,
            callSid,
            twilioFromNumber,
            transferTo,
            supabase,
            env,
            knowledgeBaseId,
            isRealtimeCaptureEnabled,
            realtimeCaptureFields,
            callerMetadata
        } = params;

        if (!agentId || !botId || !twilioFromNumber || !userId) {
            console.error("Missing parameters", agentId, botId, twilioFromNumber, userId);
            throw new Error("Missing parameters");
        }

        let account_sid = "";
        let auth_token = "";

        // Get Twilio number details
        const { data: twilioNumber, error: twilioNumberError } = await supabase
            .from('twilio_phone_numbers')
            .select('id, account_id')
            .eq('phone_number', twilioFromNumber);

        console.log(twilioNumber, "Getting data from twilio_number table for agent-based call");

        if (twilioNumberError) {
            console.error("Twilio Number not found", twilioNumberError);
            throw new Error("Twilio Number not found");
        }

        // Get Twilio account details
        const { data: twilioAccount, error: twilioAccountError } = await supabase
            .from('twilio_account')
            .select('account_sid, auth_token, user_id')
            .eq('id', twilioNumber[0].account_id)
            .single();

        if (twilioAccountError) {
            console.error("Twilio Account not found for This User", twilioAccountError);
            throw new Error("Twilio Account not found for This User");
        }

        if (twilioAccount.user_id !== userId) {
            console.error("Unauthorized to use this Twilio Account");
            throw new Error("Unauthorized to use this Twilio Account");
        }

        account_sid = twilioAccount.account_sid;
        auth_token = twilioAccount.auth_token;

        // Use Agent API to create call
        const agentService = UltravoxAgentService.getInstance(env, supabase);

        console.log("[TwilioService] Creating call with agent:", agentId);

        // Build metadata for the agent call
        const metadata: Record<string, string> = {
            bot_id: botId,
            user_id: userId,
            ...(callerMetadata?.caller_number && { caller_number: callerMetadata.caller_number }),
            ...(callerMetadata?.caller_country && { caller_country: callerMetadata.caller_country }),
            ...(callerMetadata?.caller_state && { caller_state: callerMetadata.caller_state }),
            ...(callerMetadata?.caller_city && { caller_city: callerMetadata.caller_city }),
            ...(callerMetadata?.caller_zip && { caller_zip: callerMetadata.caller_zip }),
            ...(callerMetadata?.called_number && { called_number: callerMetadata.called_number }),
            ...(callerMetadata?.called_country && { called_country: callerMetadata.called_country }),
            ...(callerMetadata?.called_state && { called_state: callerMetadata.called_state }),
            ...(callerMetadata?.called_city && { called_city: callerMetadata.called_city }),
            ...(callerMetadata?.called_zip && { called_zip: callerMetadata.called_zip }),
        };

        // Create the agent call
        const agentCallResponse = await agentService.createCallWithAgent(agentId, {
            metadata,
            recordingEnabled: true,
            medium: {
                twilio: {}
            },
        });

        const { joinUrl, callId: ultravoxCallId } = agentCallResponse;

        console.log("[TwilioService] Agent call created:", ultravoxCallId);

        let additional_data_to_store_in_call_records: {
            transferTo?: string;
        } = {};

        if (transferTo) {
            additional_data_to_store_in_call_records.transferTo = transferTo;
        }

        // Store call record in database
        const { data: pushedCallToCallRecords, error: errorPushedCallToCallRecords } = await supabase
            .from('call_records')
            .insert([
                {
                    call_id: ultravoxCallId,
                    bot_id: botId,
                    user_id: userId,
                    additional_data: additional_data_to_store_in_call_records,
                }
            ])
            .select();

        if (errorPushedCallToCallRecords) {
            throw new Error("Failed to push call to call records", {
                cause: errorPushedCallToCallRecords
            });
        }

        // Store call data in KV
        await this.storeCallData(ultravoxCallId, {
            config: {
                metadata,
                recordingEnabled: true,
                medium: { twilio: {} }
            } as CallConfig,
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
            joinUrlResponse: agentCallResponse as JoinUrlResponse,
            twilioData: {
                auth_token,
                account_sid,
                from_phone_number: twilioFromNumber,
                to_number: "inbound",
                user_id: userId,
            },
            transferTo: transferTo,
            numberLockingEnabled: false
        });

        return {
            joinUrl
        };
    }

    async makeCallWithAgent(params: {
        agentId: string;
        botId: string;
        toNumber: string;
        twilioFromNumber: string;
        userId: string;
        transferTo?: string;
        supabase: SupabaseClient;
        env: Env;
        knowledgeBaseId?: string;
        isRealtimeCaptureEnabled?: boolean;
        realtimeCaptureFields?: any[];
        enableNumberLocking?: boolean;
    }): Promise<{
        from_number: string;
        to_number: string;
        bot_id: string;
        status: string;
        callId: string;
    }> {
        const {
            agentId,
            botId,
            toNumber,
            twilioFromNumber,
            userId,
            transferTo,
            supabase,
            env,
            knowledgeBaseId,
            isRealtimeCaptureEnabled,
            realtimeCaptureFields,
            enableNumberLocking
        } = params;

        if (!agentId || !botId || !toNumber || !twilioFromNumber || !userId) {
            console.error("Missing parameters", { agentId, botId, toNumber, twilioFromNumber, userId });
            throw new Error("Missing parameters");
        }

        let account_sid = "";
        let auth_token = "";
        let selectedTwilioNumber = twilioFromNumber;

        // Number locking logic (same as makeCall)
        if (enableNumberLocking) {
            const normalizedTwilioNumber = this.normalizeNumberForLocking(twilioFromNumber);
            const twilioLockKey = `locked_twilio:${normalizedTwilioNumber}`;
            const isTwilioLocked = await env.ACTIVE_CALLS.get(twilioLockKey);

            if (isTwilioLocked) {
                console.log(`⚠️  Number ${normalizedTwilioNumber} already locked: ${isTwilioLocked}`);

                // Check if this is a stale lock
                try {
                    const lockParts = isTwilioLocked.split('_');
                    if (lockParts.length === 2) {
                        const lockTimestamp = parseInt(lockParts[0]);
                        const currentTime = Date.now();
                        const lockAge = currentTime - lockTimestamp;
                        const maxLockAge = 2 * 60 * 1000; // 2 minutes

                        if (lockAge > maxLockAge) {
                            console.log(`🧹 Clearing stale lock for ${normalizedTwilioNumber}`);
                            await env.ACTIVE_CALLS.delete(twilioLockKey);
                            console.log(`✅ Cleared stale lock, proceeding with call`);
                        } else {
                            throw new Error(`TWILIO_BUSY:${twilioFromNumber}`);
                        }
                    } else {
                        throw new Error(`TWILIO_BUSY:${twilioFromNumber}`);
                    }
                } catch (staleLockError) {
                    console.log(`❌ Error checking stale lock: ${staleLockError}`);
                    throw new Error(`TWILIO_BUSY:${twilioFromNumber}`);
                }
            }

            // Lock the Twilio FROM number
            const lockId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            await env.ACTIVE_CALLS.put(twilioLockKey, lockId, { expirationTtl: 120 });
            console.log(`🔒 SUCCESSFULLY LOCKED Twilio number: ${twilioFromNumber} (normalized: ${normalizedTwilioNumber}) with ID: ${lockId}`);
        }

        // Get Twilio number details
        console.log(`🔍 Looking up Twilio number in database: "${selectedTwilioNumber}"`);
        const { data: twilioNumber, error: twilioNumberError } = await supabase
            .from('twilio_phone_numbers')
            .select('id, account_id, phone_number')
            .eq('phone_number', selectedTwilioNumber);

        if (twilioNumberError || !twilioNumber || twilioNumber.length === 0) {
            console.error("❌ Twilio Number not found:", selectedTwilioNumber);
            throw new Error("Twilio Number not found");
        }

        // Get Twilio account details
        const { data: twilioAccount, error: twilioAccountError } = await supabase
            .from('twilio_account')
            .select('account_sid, auth_token, user_id')
            .eq('id', twilioNumber[0].account_id)
            .single();

        if (twilioAccountError) {
            console.error("❌ Twilio Account not found");
            throw new Error("Twilio Account not found for This User");
        }

        if (twilioAccount.user_id !== userId) {
            console.error("❌ Unauthorized to use this Twilio Account");
            throw new Error("Unauthorized to use this Twilio Account");
        }

        account_sid = twilioAccount.account_sid;
        auth_token = twilioAccount.auth_token;

        // Use Agent API to create call
        const agentService = UltravoxAgentService.getInstance(env, supabase);
        console.log("[TwilioService] Creating outbound call with agent:", agentId);

        // Build metadata for the agent call
        const metadata: Record<string, string> = {
            bot_id: botId,
            user_id: userId,
            customer_number: toNumber,
        };

        // Create the agent call
        const agentCallResponse = await agentService.createCallWithAgent(agentId, {
            metadata,
            recordingEnabled: true,
            medium: {
                twilio: {}
            },
        });

        const { joinUrl, callId: ultravoxCallId } = agentCallResponse;
        console.log("[TwilioService] Agent call created:", ultravoxCallId);

        let additional_data_to_store_in_call_records: {
            transferTo?: string;
        } = {};

        if (transferTo) {
            additional_data_to_store_in_call_records.transferTo = transferTo;
        }

        // Store call record in database
        const { data: pushedCallToCallRecords, error: errorPushedCallToCallRecords } = await supabase
            .from('call_records')
            .insert([
                {
                    call_id: ultravoxCallId,
                    bot_id: botId,
                    user_id: userId,
                    additional_data: additional_data_to_store_in_call_records,
                }
            ])
            .select();

        if (errorPushedCallToCallRecords) {
            console.error("Error pushing call to call records", errorPushedCallToCallRecords);
        }

        let parse_to_number = toNumber.replaceAll('-', '');
        parse_to_number = parse_to_number.replaceAll(' ', '');

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
                AsyncAmdStatusCallback: 'https://d12ae112dc27.ngrok-free.app/api/async-amd-status',
            })
        });

        if (!twilioResponse.ok) {
            // If call fails and number locking is enabled, unlock the Twilio FROM number
            if (enableNumberLocking) {
                const normalizedNumber = this.normalizeNumberForLocking(selectedTwilioNumber);
                const twilioLockKey = `locked_twilio:${normalizedNumber}`;
                try {
                    await env.ACTIVE_CALLS.delete(twilioLockKey);
                    console.log(`🔓 Unlocked Twilio number due to call failure`);
                } catch (unlockError) {
                    console.error(`Error unlocking Twilio number:`, unlockError);
                }
            }

            const errorText = await twilioResponse.text();
            throw new Error(`Twilio API error: ${errorText}`);
        }

        const twilioData: twilioData = await twilioResponse.json();

        console.log("added this call to activeCalls", ultravoxCallId, transferTo, "trans");

        // Store call data in KV
        await this.storeCallData(ultravoxCallId, {
            config: {
                metadata,
                recordingEnabled: true,
                medium: { twilio: {} }
            } as CallConfig,
            twilioResponseData: twilioData,
            joinUrlResponse: agentCallResponse as JoinUrlResponse,
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

        console.log("Stored call data for:", ultravoxCallId);

        return {
            from_number: selectedTwilioNumber,
            to_number: toNumber,
            bot_id: botId,
            status: twilioData.status,
            callId: ultravoxCallId
        };
    }

    async makeCall(params: {
        callConfig: CallConfig;
        botId: string;
        toNumber: string;
        twilioFromNumber: string;
        twilioFromNumbers?: string[]; // Array of available numbers
        userId: string;
        placeholders?: Record<string, string>;
        tools: SelectedTool[];
        supabase: SupabaseClient;
        env: Env;
        transferTo?: string;
        isSingleTwilioAccount?: boolean;
        configureBots?: boolean;
        enableNumberLocking?: boolean;
    }) {
        const { botId, toNumber, twilioFromNumber, twilioFromNumbers, userId, placeholders, tools, supabase, env, isSingleTwilioAccount, callConfig: call_config, configureBots, enableNumberLocking } = params;
        const callConfig = call_config;
        let transferTo = params.transferTo;
        console.log("=== TwilioService makeCall ===");
        console.log("From:", twilioFromNumber);
        console.log("To:", toNumber);

        let account_sid = "";
        let auth_token = "";
        let selectedTwilioNumber = twilioFromNumber;

        if (!botId || !toNumber || !userId) {
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
                        console.log(`🕐 Lock age: ${Math.floor(lockAge / 1000)}s (created at: ${new Date(lockTimestamp).toISOString()})`);
                        console.log(`🕐 Current time: ${new Date(currentTime).toISOString()}`);
                        console.log(`🕐 Lock will expire in: ${Math.floor((10 * 60 * 1000 - lockAge) / 1000)}s`);
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
                                console.log(`🧹 Clearing stale lock for ${normalizedNumber} (age: ${Math.floor(lockAge / 1000)}s)`);
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
                            console.log(`🧹 Clearing stale single number lock for ${normalizedTwilioNumber} (age: ${Math.floor(lockAge / 1000)}s)`);
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
            console.error("Twilio Account not found for This User", twilioAccountError);
            throw new Error("Twilio Account not found for This User");
        }

        if (twilioAccount.user_id !== userId) {
            console.error("Unauthorized to use this Twilio Account");
            throw new Error("Unauthorized to use this Twilio Account");
        }

        account_sid = twilioAccount.account_sid;
        auth_token = twilioAccount.auth_token;

        if (call_config?.metadata?.contact_id) {
            if (!callConfig.metadata) callConfig.metadata = {};
            callConfig.metadata.contact_id = call_config.metadata.contact_id;
            console.log(`📋 Preserving contact_id in metadata: ${call_config.metadata.contact_id}`);
        }

        if (call_config?.metadata?.campaign_id) {
            if (!callConfig.metadata) callConfig.metadata = {};
            callConfig.metadata.campaign_id = call_config.metadata.campaign_id;
            console.log(`📋 Preserving campaign_id in metadata: ${call_config.metadata.campaign_id}`);
        }

        if (toNumber) {
            if (!callConfig.metadata) callConfig.metadata = {};
            callConfig.metadata.customer_number = toNumber;
            console.log(`📋 Preserving customer_number in metadata: ${toNumber}`);
        }

        console.log(`🔍 Final metadata being sent to Ultravox:`, JSON.stringify(callConfig.metadata));

        if (!callConfig.selectedTools?.some((tool: any) => tool.toolName === "hangUp")) {
            callConfig.selectedTools?.push({
                toolName: "hangUp"
            });
        }

        if (!callConfig.selectedTools?.some((tool: any) => tool.toolName === "leaveVoicemail")) {
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

            if (ultravoxResponse.status === 429) {
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

        if (placeholders) {
            additional_data_to_store_in_call_records.placeholders = placeholders;
        }

        if (transferTo) {
            additional_data_to_store_in_call_records.transferTo = transferTo;
        } else if (bot.is_call_transfer_allowed) {
            additional_data_to_store_in_call_records.transferTo = bot.call_transfer_number;
            transferTo = bot.call_transfer_number;
        }

        if (isSingleTwilioAccount) {
            additional_data_to_store_in_call_records.isSingleTwilioAccount = true;
        }

        //the call is sucess push it to db
        const { data: pushedCallToCallRecords, error: errorPushedCallToCallRecords } = await supabase
            .from('call_records')
            .insert([{ user_id: userId, call_id: ultravoxCallId, bot_id: botId, additional_data: additional_data_to_store_in_call_records }])
            .select();

        if (errorPushedCallToCallRecords) {
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
                AsyncAmdStatusCallback: 'https://d12ae112dc27.ngrok-free.app/api/async-amd-status',
            })
        });

        if (!twilioResponse.ok) {
            // If call fails and number locking is enabled, unlock the Twilio FROM number
            if (enableNumberLocking) {
                const normalizedNumber = this.normalizeNumberForLocking(selectedTwilioNumber);
                const twilioLockKey = `locked_twilio:${normalizedNumber}`;
                try {
                    await env.ACTIVE_CALLS.delete(twilioLockKey);
                    console.log(`🔓 Unlocked Twilio number due to call failure`);
                } catch (unlockError) {
                    console.error(`Error unlocking Twilio number:`, unlockError);
                }
            }

            const errorText = await twilioResponse.text();
            throw new Error(`Twilio API error: ${errorText}`);
        }

        const twilioData: twilioData = await twilioResponse.json();

        console.log("added this call to activeCalls", ultravoxCallId, transferTo, "trans");

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

        console.log("Stored call data for:", ultravoxCallId);

        return {
            from_number: selectedTwilioNumber,
            to_number: toNumber,
            bot_id: botId,
            status: twilioData.status,
            callId: ultravoxCallId
        };
    }

    async transferCall(body: TransferCallRequest, callId: string) {
        const { transferToNumber: agentProvidedNumber, transferReason, urgencyLevel } = body;
        console.log("Parsed Transfer Call Request:");
        console.log(body);
        console.log("Transfer To Number (from agent):", agentProvidedNumber);
        console.log("Transfer Reason:", transferReason);
        console.log("Urgency Level:", urgencyLevel);

        // Get call data from KV first to check for stored transfer number
        const call = await this.getCallData(callId);
        if (!call) {
            console.error("Call not found:", callId);
            throw new Error('Call not found');
        }

        let transferNumber = agentProvidedNumber;

        // Prioritize stored transferTo number if it exists
        if (call.transferTo) {
            console.log(`✅ Found stored transfer number in call data: ${call.transferTo}`);
            if (agentProvidedNumber && agentProvidedNumber !== call.transferTo) {
                console.warn(`⚠️ Overriding agent-provided number ${agentProvidedNumber} with stored number ${call.transferTo}`);
            }
            transferNumber = call.transferTo;
        } else {
            console.log("ℹ️ No stored transfer number found, using agent-provided number");
        }

        // Validate the transfer number
        if (!transferNumber || transferNumber === '' || transferNumber === 'undefined') {
            console.error("=== TRANSFER CALL ERROR: No transfer number provided ===");
            console.error("Body received:", body);
            console.error("AI called transferCall tool WITHOUT collecting phone number from user!");
            throw new Error('Transfer destination number not provided. AI must ask user for phone number before calling this tool.');
        }

        // Validate E.164 format
        if (!transferNumber.startsWith('+')) {
            console.error("=== TRANSFER CALL ERROR: Invalid phone format ===");
            console.error("Provided number:", transferNumber);
            throw new Error('Transfer number must be in E.164 format (start with + and country code)');
        }

        console.log("Call found in active calls");
        const { config: callConfig, twilioData, joinUrlResponse, twilioResponseData } = call;

        console.log("Twilio Data:", {
            account_sid: twilioData.account_sid,
            from_phone_number: twilioData.from_phone_number,
            to_number: twilioData.to_number
        });
        console.log("Twilio Response Data SID:", twilioResponseData.sid);

        console.log("Using dynamic transfer destination:", transferNumber);

        // Initialize Twilio client
        console.log("Initializing Twilio client...");
        const client = twilio(twilioData.account_sid, twilioData.auth_token);

        // Create TwiML for transfer
        console.log("Creating TwiML for transfer...");
        const twiml = new VoiceResponse();
        console.log("Transfer destination number:", transferNumber);

        twiml.dial().number(transferNumber);
        const twimlString = twiml.toString();
        console.log("Generated TwiML:", twimlString);

        // Update the call with new TwiML
        console.log("Updating Twilio call with transfer TwiML...");
        try {
            const UpdatedCall = await client.calls(twilioResponseData.sid).update({
                twiml: twimlString
            });
            console.log("Call updated successfully");
            console.log("Updated Call Status:", UpdatedCall.status);
            console.log("Updated Call SID:", UpdatedCall.sid);
        } catch (error) {
            console.error("=== ERROR UPDATING TWILIO CALL ===");
            console.error("Error details:", error);
            throw error;
        }

        console.log("=== TRANSFER CALL COMPLETED ===");
        return {
            callId,
            transferToNumber: transferNumber,
            transferReason,
            urgencyLevel,
            status: 'transferring'
        };
    }

    async voiceMailDetector(callSid: string, twilioSid: string) {
        const call = await this.getCallDataByTwilioCallSid(callSid);
        if (!call) {
            console.error("Call not found:", callSid, twilioSid);
            throw new Error('Call not found');
        }

        try {
            const { config: callConfig, twilioData, joinUrlResponse, twilioResponseData } = call;

            if (twilioSid !== twilioData.account_sid) {
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

        } catch (error) {
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
                return {
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
            return {
                userId: null,
                TimeTaken: 0,
                callId: null
            };
        }
    }
    async configureBotTools(botId: string, tools: SelectedTool[]) {
        // Placeholder for configureBotTools
        console.log("Configuring bot tools for:", botId);
    }

    async getCustomerTimezone(phoneNumber: string): Promise<string> {
        try {
            const countryCode = this.extractCountryCode(phoneNumber);
            if (countryCode === '+1') return 'America/New_York';
            if (countryCode === '+44') return 'Europe/London';
            if (countryCode === '+91') return 'Asia/Kolkata';
            return 'UTC';
        } catch (error) {
            console.error("Error getting customer timezone:", error);
            return 'UTC';
        }
    }

    extractCountryCode(phoneNumber: string): string {
        if (phoneNumber.startsWith('+')) {
            if (phoneNumber.startsWith('+1')) return '+1';
            if (phoneNumber.startsWith('+44')) return '+44';
            if (phoneNumber.startsWith('+91')) return '+91';
            return phoneNumber.substring(0, 3);
        }
        return '';
    }

    async sortNumbersByTimezoneProximity(numbers: string[], customerTimezone: string, supabase: SupabaseClient): Promise<string[]> {
        // Placeholder implementation
        return numbers;
    }
}
