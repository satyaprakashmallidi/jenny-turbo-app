import { CallConfig, JoinUrlResponse, twilioData } from "@repo/common-types/types";
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
    }
};

type UrgencyLevel = 'low' | 'medium' | 'high';

interface TransferCallRequest {
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
        tools: string[];
        supabase: SupabaseClient;
        env: Env;
    }) {
        const { botId, toNumber, twilioFromNumber, userId, placeholders, tools, supabase, env } = params;

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
            .select('id')
            .eq('phone_number', twilioFromNumber)
            .single();

        if (twilioNumberError || !twilioNumber?.id) {
            throw new Error("Twilio Number not found");
        }

        // Get Twilio account details
        const { data: twilioAccount, error: twilioAccountError } = await supabase
            .from('twilio_account')
            .select('account_sid, auth_token')
            .eq('id', twilioNumber.id)
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

        const selectedTools = tools ? tools.map((id: string) => ({ toolId: id })) : [];

        const callConfig: CallConfig = {
            systemPrompt: system_prompt,
            voice: voice,
            recordingEnabled: true,
            joinTimeout: "30s",
            medium: {
                twilio: {}
            },
            selectedTools: [
                { toolName: "hangUp" },
                { toolName: "transferCall" },
                ...selectedTools
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
        const { transferReason, urgencyLevel } = body;

        console.log("Transfer Call Request: ", body);

        if (!this.activeCalls[callId]) {
            console.error("Received /twilio/transfer-call Error", `Call with id ${callId} not found`);
            throw new Error('Call not found');
        }

        const {config : callConfig, twilioData , joinUrlResponse , twilioResponseData } = this.activeCalls[callId];

        const client = twilio(twilioData.account_sid, twilioData.auth_token);

        const twiml = new twilio.twiml.VoiceResponse();

        twiml.dial().number("+919014325088");

        //updating
        const UpdatedCall = await client.calls(twilioResponseData.sid).update({
            twiml: twiml.toString()
        });

        // TODO: Implement transfer call logic
        return {
            callId,
            transferReason,
            urgencyLevel,
            status: 'transferring'
        };
    }
}