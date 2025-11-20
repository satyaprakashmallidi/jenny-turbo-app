import { CallConfig, JoinUrlResponse, twilioData, SelectedTool } from "@repo/common-types/types";
import { SupabaseClient } from "@supabase/supabase-js";
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
    };
};

type UrgencyLevel = 'low' | 'medium' | 'high';

interface TransferCallRequest {
    transferToNumber: string; // Dynamic phone number from user
    transferReason: string;
    urgencyLevel: UrgencyLevel;
}

export class TwilioService {
    private static instance: TwilioService;
    private constructor() {}

    private activeCalls: Record<string, CallRecord> = {};

    public static getInstance(): TwilioService {
        if (!TwilioService.instance) {
            TwilioService.instance = new TwilioService();
        }
        return TwilioService.instance;
    }

    async makeCall(params: {
        botId: string;
        toNumber: string;
        twilioFromNumber: string;
        userId: string;
        placeholders?: Record<string, string>;
        tools: SelectedTool[];
        supabase: SupabaseClient;
        env: Env;
    }) {
        const { botId, toNumber, twilioFromNumber, userId, placeholders, tools, supabase, env } = params;

        if(!botId || !toNumber || !twilioFromNumber || !userId){
            throw new Error("Missing parameters");
        }

        console.log("=== TwilioService makeCall ===");
        console.log("From:", twilioFromNumber);
        console.log("To:", toNumber);

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
            .eq('phone_number', twilioFromNumber)
            .single();

        if (twilioNumberError || !twilioNumber?.account_id) {
            throw new Error("Twilio Number not found");
        }

        // Get Twilio account details
        const { data: twilioAccount, error: twilioAccountError } = await supabase
            .from('twilio_account')
            .select('account_sid, auth_token')
            .eq('id', twilioNumber.account_id)
            .eq('user_id', userId)
            .single();

        if (twilioAccountError) {
            throw new Error("Twilio Account not found");
        }

        const { account_sid, auth_token } = twilioAccount;
        let { voice, system_prompt } = bot;

        // Replace placeholders in system prompt
        if(placeholders) {
            let leftDelimiter = placeholders?.left_delimeter || "<<<";
            let rightDelimiter = placeholders?.right_delimeter || ">>>";
            const regexPattern = new RegExp(`${leftDelimiter}(\\w+)${rightDelimiter}`, 'g');
            system_prompt = system_prompt.replace(regexPattern, (match: string, key: string) => placeholders[key] || match);
        }

        // Tools are already in the correct SelectedTool[] format from the frontend
        const selectedTools = tools || [];

        // Helper function to get tool identifier
        const getToolIdentifier = (tool: SelectedTool): string => {
            return tool.toolName || tool.temporaryTool?.modelToolName || tool.toolId || '';
        };

        // Helper to check if tool is a temporaryTool (more complete than simple toolName)
        const isTemporaryTool = (tool: SelectedTool): boolean => {
            return !!tool.temporaryTool;
        };

        // Deduplicate tools - prioritize temporaryTools over simple toolName references
        const toolMap = new Map<string, SelectedTool>();

        // First, process selectedTools from frontend (they take priority)
        for (const tool of selectedTools) {
            const identifier = getToolIdentifier(tool);
            if (identifier) {
                const existing = toolMap.get(identifier);
                // Keep the tool if it's new, or if it's a temporaryTool replacing a simple one
                if (!existing || (isTemporaryTool(tool) && !isTemporaryTool(existing))) {
                    toolMap.set(identifier, tool);
                }
            }
        }

        // Then add default tools only if not already present
        const defaultTools: SelectedTool[] = [
            { toolName: "hangUp" },
            { toolName: "transferCall" }
        ];

        for (const tool of defaultTools) {
            const identifier = getToolIdentifier(tool);
            if (identifier && !toolMap.has(identifier)) {
                toolMap.set(identifier, tool);
            }
        }

        const deduplicatedTools = Array.from(toolMap.values());

        console.log("Tools before deduplication:", selectedTools.length + defaultTools.length);
        console.log("Tools after deduplication:", deduplicatedTools.length);
        console.log("Deduplicated tool names:", Array.from(toolMap.keys()));

        const callConfig: CallConfig = {
            systemPrompt: system_prompt,
            voice: voice,
            recordingEnabled: true,
            joinTimeout: "30s",
            medium: {
                twilio: {}
            },
            selectedTools: deduplicatedTools
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
            throw new Error(`Twilio API error: ${errorText}`);
        }

        const twilioData: twilioData = await twilioResponse.json();

        this.activeCalls[ultravoxCallId] = {
            config: callConfig,
            twilioResponseData: twilioData,
            joinUrlResponse: ultravoxData,
            twilioData: {
                auth_token : auth_token,
                account_sid : account_sid,
                from_phone_number : twilioFromNumber,
                to_number : toNumber
            }
        };

        console.log("Stored call record for call ID:", ultravoxCallId);

        // Save call to database
        const addCallToDbResponse = await fetch('https://jenny-ai-turo.everyai-com.workers.dev/api/add-call-to-db', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                call_id: ultravoxCallId,
                bot_id: botId,
                user_id: userId,
                placeholders: placeholders
            })
        });

        if (!addCallToDbResponse.ok) {
            const errorText = await addCallToDbResponse.text();
            console.error("Received error while adding the call to the db", errorText);
        }

        return {
            from_number: twilioFromNumber,
            to_number: toNumber,
            bot_id: botId,
            status: twilioData.status
        };
    }

    async transferCall(body: TransferCallRequest, callId: string) {
        console.log("=== TRANSFER CALL STARTED ===");
        console.log("Call ID:", callId);
        console.log("Transfer Request Body:", JSON.stringify(body, null, 2));

        const { transferToNumber, transferReason, urgencyLevel } = body;
        console.log("Parsed Transfer Call Request:");
        console.log(body)
        console.log("Transfer To Number (from user):", transferToNumber);
        console.log("Transfer Reason:", transferReason);
        console.log("Urgency Level:", urgencyLevel);

        // Validate the transfer number
        if (!transferToNumber || transferToNumber === '' || transferToNumber === 'undefined') {
            console.error("=== TRANSFER CALL ERROR: No transfer number provided ===");
            console.error("Body received:", body);
            console.error("AI called transferCall tool WITHOUT collecting phone number from user!");
            throw new Error('Transfer destination number not provided. AI must ask user for phone number before calling this tool.');
        }

        // Validate E.164 format
        if (!transferToNumber.startsWith('+')) {
            console.error("=== TRANSFER CALL ERROR: Invalid phone format ===");
            console.error("Provided number:", transferToNumber);
            throw new Error('Transfer number must be in E.164 format (start with + and country code)');
        }

        // Check if call exists in active calls
        if (!this.activeCalls[callId]) {
            console.error("=== TRANSFER CALL ERROR: Call Not Found ===");
            console.error("Call ID:", callId);
            console.error("Active Calls:", Object.keys(this.activeCalls));
            throw new Error('Call not found');
        }

        console.log("Call found in active calls");
        const {config : callConfig, twilioData , joinUrlResponse , twilioResponseData } = this.activeCalls[callId];

        console.log("Twilio Data:", {
            account_sid: twilioData.account_sid,
            from_phone_number: twilioData.from_phone_number,
            to_number: twilioData.to_number
        });
        console.log("Twilio Response Data SID:", twilioResponseData.sid);

        // Use the dynamic transfer number from the request
        const transferNumber = transferToNumber;
        console.log("Using dynamic transfer destination:", transferNumber);

        // Initialize Twilio client
        console.log("Initializing Twilio client...");
        const client = twilio(twilioData.account_sid, twilioData.auth_token);

        // Create TwiML for transfer
        console.log("Creating TwiML for transfer...");
        const twiml = new twilio.twiml.VoiceResponse();
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
}