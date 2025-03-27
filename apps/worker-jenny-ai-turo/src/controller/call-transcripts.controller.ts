import { Context } from "hono";
import { getEnv } from "../config/env";
import { getSupabaseClient } from "../lib/supabase/client";
import { CallTranscriptsService } from "../services/call-transcripts.service";

export const getCallTranscripts = async (c: Context) => {
    const callId = c.req.param('callId');
    const pageSize = c.req.query('pageSize') ? parseInt(c.req.query('pageSize')!) : undefined;
    const cursor = c.req.query('cursor');
    
    console.log(`[TRANSCRIPTS CONTROLLER] Processing request - callId: ${callId || 'missing'}, pageSize: ${pageSize || 'default'}, cursor: ${cursor || 'none'}`);
    
    try {
        const env = getEnv(c.env);
        const db = getSupabaseClient(env);
        const callTranscriptsService = CallTranscriptsService.getInstance(env, db);
        
        if (!callId) {
            console.error(`[TRANSCRIPTS CONTROLLER] Missing required parameter - callId`);
            return c.json({
                status: 'error',
                message: 'Call ID is required'
            }, 400);
        }
        
        console.log(`[TRANSCRIPTS CONTROLLER] Calling service to fetch and store transcript - callId: ${callId}`);
        
        try {
            // Fetch transcript from API AND store in database (now sequential)
            const transcript = await callTranscriptsService.getCallTranscript(callId, pageSize, cursor);
            
            console.log(`[TRANSCRIPTS CONTROLLER] Successfully retrieved transcript - callId: ${callId}, messages: ${transcript.results.length}`);
            
            // Check if there was a call record missing warning
            if (transcript.warning) {
                console.log(`[TRANSCRIPTS CONTROLLER] Warning in response: ${transcript.warning}`);
                return c.json({
                    status: 'success',
                    data: transcript,
                    warning: transcript.warning
                });
            }
            
            return c.json({
                status: 'success',
                data: transcript
            });
        } catch (serviceError) {
            // Check if this is a database storage error related to foreign key constraint
            if (serviceError instanceof Error && 
                (serviceError.message.includes('foreign key constraint') || 
                 serviceError.message.includes('call_records'))) {
                console.error(`[TRANSCRIPTS CONTROLLER] Database foreign key error - callId: ${callId}`, serviceError);
                return c.json({
                    status: 'error',
                    message: 'Cannot store transcript: No call record exists for this call ID',
                    error: 'The call transcript requires a call_records entry before it can be stored',
                    details: serviceError.message
                }, 400); // Using 400 for this case as it's a client issue, not server
            }
            
            // Check if this is another database storage error
            if (serviceError instanceof Error && serviceError.message.includes('Failed to store call transcript')) {
                console.error(`[TRANSCRIPTS CONTROLLER] Database storage error - callId: ${callId}`, serviceError);
                return c.json({
                    status: 'error',
                    message: 'Error storing call transcripts in database',
                    error: serviceError.message
                }, 500);
            }
            
            // Otherwise it's likely an API fetch error
            console.error(`[TRANSCRIPTS CONTROLLER] API error - callId: ${callId}`, serviceError);
            return c.json({
                status: 'error',
                message: 'Error fetching call transcripts from API',
                error: serviceError instanceof Error ? serviceError.message : String(serviceError)
            }, 500);
        }
    } catch (error) {
        console.error(`[TRANSCRIPTS CONTROLLER] Unexpected error in getCallTranscripts - callId: ${callId}`, error);
        return c.json({
            status: 'error',
            message: 'Unexpected error processing call transcripts request',
            error: error instanceof Error ? error.message : String(error)
        }, 500);
    }
}

