import { SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import { CallMessage, CallTranscriptResponse } from '../types/transcripts';

export class CallTranscriptsService {
  private static instance: CallTranscriptsService;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly env: Env;
  private readonly db: SupabaseClient;

  private constructor(env: Env, db: SupabaseClient) {
    this.env = env;
    this.db = db;
    this.apiKey = env.ULTRAVOX_API_KEY;
    this.baseUrl = 'https://api.ultravox.ai/api';
  }

  public static getInstance(env: Env, db: SupabaseClient): CallTranscriptsService {
    if (!CallTranscriptsService.instance) {
      CallTranscriptsService.instance = new CallTranscriptsService(env, db);
    }
    return CallTranscriptsService.instance;
  }

  async getCallTranscript(callId: string, pageSize?: number, cursor?: string): Promise<CallTranscriptResponse> {
    console.log(`[TRANSCRIPTS] Fetching call transcript - callId: ${callId}, pageSize: ${pageSize || 100}, cursor: ${cursor || 'none'}`);
    
    try {
      // Default page size to 100 if not provided
      const effectivePageSize = pageSize || 100;
      
      // Build URL with query parameters
      let url = `${this.baseUrl}/calls/${callId}/messages`;
      const params = new URLSearchParams();
      
      params.append('pageSize', effectivePageSize.toString());
      
      if (cursor) {
        params.append('cursor', cursor);
      }
      
      // Append params to URL
      const queryString = params.toString();
      if (queryString) {
        url = `${url}?${queryString}`;
      }

      console.log(`[TRANSCRIPTS] Making API request to: ${url}`);

      // Make the fetch request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        console.error(`[TRANSCRIPTS] API request failed - callId: ${callId}, status: ${response.status}, message: ${errorData.message || response.statusText}`);
        throw new Error(`API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json() as CallTranscriptResponse;
      console.log(`[TRANSCRIPTS] API request successful - callId: ${callId}, total messages: ${data.results.length}, next cursor: ${data.next || 'none'}`);
      
      // SEQUENTIAL PROCESSING: Store the data first, then return the response
      try {
        // First check if a call_record exists for this call_id
        console.log(`[TRANSCRIPTS] Checking if call record exists for call_id: ${callId}`);
        const { data: callRecords, error: callRecordsError } = await this.db
          .from('call_records')
          .select('call_id, created_at')
          .eq('call_id', callId)
          .limit(1);
          
        if (callRecordsError) {
          console.error(`[TRANSCRIPTS] Error checking for call record:`, callRecordsError);
          console.log(`[TRANSCRIPTS] Skipping database storage due to error checking call_records`);
          // Add warning to response
          const responseWithWarning = {
            ...data,
            warning: "Transcript not stored in database: Error checking call_records table"
          };
          return responseWithWarning;
        }
        
        if (!callRecords || callRecords.length === 0) {
          console.log(`[TRANSCRIPTS] No call record found for call_id ${callId}. Skipping database storage.`);
          console.log(`[TRANSCRIPTS] To store transcripts, first create a record in the call_records table with this call_id`);
          // Add warning to response
          const responseWithWarning = {
            ...data,
            warning: "Transcript not stored in database: No record found in call_records table with this call_id"
          };
          return responseWithWarning;
        }
        
        const callRecord = callRecords[0];
        console.log(`[TRANSCRIPTS] Found call record: call_id=${callRecord.call_id}, created_at=${callRecord.created_at}`);
        
        console.log(`[TRANSCRIPTS] Starting transcript storage - callId: ${callId}`);
        // Pass the call record's created_at to ensure foreign key constraint is satisfied
        await this.storeTranscriptChunks(callId, data.results, callRecord.created_at);
        console.log(`[TRANSCRIPTS] Successfully completed storing transcript chunks for call ${callId}`);
      } catch (storageError) {
        console.error(`[TRANSCRIPTS] Error storing transcript chunks for call ${callId}:`, storageError);
        console.error(`[TRANSCRIPTS] Error details:`, storageError instanceof Error ? storageError.stack : String(storageError));
        throw new Error(`Failed to store call transcript: ${storageError instanceof Error ? storageError.message : String(storageError)}`);
      }
      
      return data;
    } catch (error) {
      console.error(`[TRANSCRIPTS] Failed to fetch or store call transcript - callId: ${callId}`, error);
      throw new Error(`Failed to process call transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async storeTranscriptChunks(callId: string, messages: CallMessage[], callRecordCreatedAt?: string): Promise<void> {
    console.log(`[TRANSCRIPTS] Starting process to store transcript chunks - callId: ${callId}, message count: ${messages.length}`);
    
    try {
      // Verify Supabase client is properly initialized
      if (!this.db) {
        throw new Error('Supabase client is not initialized');
      }
      
      // Check if we have auth capabilities
      const hasAuth = !!this.db.auth;
      console.log(`[TRANSCRIPTS] Supabase client check - hasAuth: ${hasAuth}`);
      
      // Check if we have database capabilities
      const hasFrom = typeof this.db.from === 'function';
      console.log(`[TRANSCRIPTS] Supabase client check - hasFrom: ${hasFrom}`);
      
      if (!hasFrom) {
        throw new Error('Supabase client does not have database access methods');
      }
      
      // Ensure valid UUID format for callId
      const validCallId = this.ensureValidUuid(callId);
      console.log(`[TRANSCRIPTS] Using call_id: ${validCallId}`);
      
      // Check if the call_transcripts table exists and what columns it has
      try {
        console.log(`[TRANSCRIPTS] Verifying table structure`);
        const { data: tableInfo, error: tableError } = await this.db
          .from('call_transcripts')
          .select('*')
          .limit(1);
          
        if (tableError) {
          console.error(`[TRANSCRIPTS] Error checking table structure:`, tableError);
          throw new Error(`Table structure check failed: ${tableError.message}`);
        }
        
        // Log table columns if available
        if (tableInfo && tableInfo.length > 0) {
          const columns = Object.keys(tableInfo[0]);
          console.log(`[TRANSCRIPTS] Table columns: ${columns.join(', ')}`);
        } else {
          console.log(`[TRANSCRIPTS] Table exists but is empty`);
        }
      } catch (tableCheckError) {
        console.error(`[TRANSCRIPTS] Exception during table structure check:`, tableCheckError);
        // Continue despite error to see what happens with the actual insert
      }
      
      // First check if we already have chunks for this call
      console.log(`[TRANSCRIPTS] Checking for existing chunks - callId: ${validCallId}`);
      
      // Log Supabase connection details (without sensitive info)
      console.log(`[TRANSCRIPTS] Database connection - isConnected: ${!!this.db}, hasAuth: ${!!this.db.auth}`);
      
      let existingChunks;
      let checkError;
      
      try {
        console.log(`[TRANSCRIPTS] Executing database query to check for existing chunks`);
        const result = await this.db
          .from('call_transcripts')
          .select('id')
          .eq('call_id', validCallId);
          
        existingChunks = result.data;
        checkError = result.error;
        console.log(`[TRANSCRIPTS] Database query complete - hasData: ${!!existingChunks}, hasError: ${!!checkError}`);
      } catch (dbQueryError) {
        console.error(`[TRANSCRIPTS] Exception during database query to check existing chunks:`, dbQueryError);
        throw dbQueryError;
      }
      
      if (checkError) {
        console.error(`[TRANSCRIPTS] Error checking for existing chunks - callId: ${validCallId}`, checkError);
        console.error(`[TRANSCRIPTS] Error details: ${JSON.stringify(checkError)}`);
        throw checkError;
      }
      
      // If chunks already exist, don't insert again
      if (existingChunks && existingChunks.length > 0) {
        console.log(`[TRANSCRIPTS] Transcript chunks already exist - callId: ${validCallId}, count: ${existingChunks.length}, skipping storage`);
        return;
      }
      
      console.log(`[TRANSCRIPTS] No existing chunks found, proceeding with storage`);
      
      // Divide messages into chunks of 10
      const chunkSize = 10;
      const chunks = [];
      
      console.log(`[TRANSCRIPTS] Dividing ${messages.length} messages into chunks of ${chunkSize} - callId: ${validCallId}`);
      
      // Use the provided call record created_at if available, otherwise use current timestamp
      const createdAt = callRecordCreatedAt || new Date().toISOString();
      console.log(`[TRANSCRIPTS] Using created_at value: ${createdAt}`);
      
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        const chunkIndex = Math.floor(i / chunkSize);
        
        chunks.push({
          call_id: validCallId,
          created_at: createdAt,
          chunk_index: chunkIndex,
          transcript_chunk: JSON.stringify(chunk)
        });
      }
      
      // Validate chunks before storage
      try {
        console.log(`[TRANSCRIPTS] Starting chunk validation`);
        this.validateChunks(chunks);
        console.log(`[TRANSCRIPTS] Chunk validation complete`);
      } catch (validationError) {
        console.error(`[TRANSCRIPTS] Validation error:`, validationError);
        throw validationError;
      }
      
      // Store chunks in database
      if (chunks.length > 0) {
        console.log(`[TRANSCRIPTS] Storing ${chunks.length} chunks in database - callId: ${validCallId}`);
        console.log(`[TRANSCRIPTS] First chunk data structure: ${JSON.stringify(chunks[0])}`);
        
        
        try {
          console.log(`[TRANSCRIPTS] Executing database insert operation`);
          
          // Try single chunk at a time
          let successCount = 0;
          let failCount = 0;
          let lastError = null;
          
          for (let i = 0; i < chunks.length; i++) {
            try {
              console.log(`[TRANSCRIPTS] Inserting chunk ${i}/${chunks.length-1}`);
              
              // Include specific field details to help diagnose issues
              const chunk = chunks[i];
              console.log(`[TRANSCRIPTS] Chunk ${i} details: call_id=${chunk.call_id}, chunk_index=${chunk.chunk_index}, created_at=${chunk.created_at}, transcript_chunk length=${chunk.transcript_chunk.length}`);
              
              const singleResult = await this.db
                .from('call_transcripts')
                .insert(chunks[i]);
                
              if (singleResult.error) {
                console.error(`[TRANSCRIPTS] Insert failed for chunk ${i}:`, singleResult.error);
                console.error(`[TRANSCRIPTS] Error code: ${singleResult.error.code}, message: ${singleResult.error.message}, details: ${JSON.stringify(singleResult.error.details)}`);
                
                // Check for common Supabase error patterns
                const errorMessage = singleResult.error.message.toLowerCase();
                if (errorMessage.includes('permission denied') || errorMessage.includes('policy')) {
                  console.error(`[TRANSCRIPTS] Detected RLS (Row Level Security) policy issue. Make sure the table has appropriate RLS policies or RLS is disabled.`);
                } else if (errorMessage.includes('violates foreign key constraint')) {
                  console.error(`[TRANSCRIPTS] Foreign key constraint violation detected. Check that referenced values exist.`);
                } else if (errorMessage.includes('violates unique constraint')) {
                  console.error(`[TRANSCRIPTS] Unique constraint violation. Record with this key already exists.`);
                } else if (errorMessage.includes('violates not-null constraint')) {
                  console.error(`[TRANSCRIPTS] Not-null constraint violation. Check required fields.`);
                }
                
                failCount++;
                lastError = singleResult.error;
              } else {
                console.log(`[TRANSCRIPTS] Successfully inserted chunk ${i}`);
                successCount++;
              }
            } catch (chunkError) {
              console.error(`[TRANSCRIPTS] Exception inserting chunk ${i}:`, chunkError);
              if (chunkError instanceof Error) {
                console.error(`[TRANSCRIPTS] Error details: name=${chunkError.name}, message=${chunkError.message}, stack=${chunkError.stack}`);
              }
              failCount++;
              lastError = chunkError;
            }
          }
          
          console.log(`[TRANSCRIPTS] Individual insert results - success: ${successCount}, failed: ${failCount}`);
          
          if (successCount > 0) {
            console.log(`[TRANSCRIPTS] Successfully stored at least some chunks in database`);
          } else if (failCount === chunks.length) {
            console.error(`[TRANSCRIPTS] All chunks failed to insert - last error:`, lastError);
            throw new Error(`All chunks failed to insert: ${lastError instanceof Error ? lastError.message : JSON.stringify(lastError)}`);
          }
        } catch (dbError) {
          console.error(`[TRANSCRIPTS] Exception during database operation - callId: ${validCallId}`, dbError);
          if (dbError instanceof Error) {
            console.error(`[TRANSCRIPTS] Error name: ${dbError.name}, message: ${dbError.message}, stack: ${dbError.stack}`);
          }
          throw dbError;
        }
      } else {
        console.log(`[TRANSCRIPTS] No chunks to store - callId: ${validCallId}`);
      }
      
      console.log(`[TRANSCRIPTS] Storage process complete - callId: ${validCallId}`);
    } catch (error) {
      console.error(`[TRANSCRIPTS] Failed to store transcript chunks - callId: ${callId}`, error);
      if (error instanceof Error) {
        console.error(`[TRANSCRIPTS] Error details - name: ${error.name}, message: ${error.message}, stack: ${error.stack}`);
      }
      throw error;
    }
  }
  
  /**
   * Ensures that the call ID is in the proper UUID format for database storage
   * @param callId The original call ID
   * @returns A properly formatted UUID string
   */
  private ensureValidUuid(callId: string): string {
    // Check if the callId is already a properly formatted UUID
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (uuidPattern.test(callId)) {
      console.log(`[TRANSCRIPTS] CallId is already in valid UUID format: ${callId}`);
      return callId;
    }
    
    console.log(`[TRANSCRIPTS] CallId may not be in valid UUID format: ${callId}`);
    
    // Remove any non-alphanumeric characters
    let cleanedId = callId.replace(/[^a-f0-9]/gi, '');
    
    // If we don't have enough characters for a UUID, pad with zeros
    while (cleanedId.length < 32) {
      cleanedId += '0';
    }
    
    // If we have too many characters, truncate
    if (cleanedId.length > 32) {
      cleanedId = cleanedId.substring(0, 32);
    }
    
    // Format the string as a UUID
    const formattedUuid = `${cleanedId.slice(0, 8)}-${cleanedId.slice(8, 12)}-${cleanedId.slice(12, 16)}-${cleanedId.slice(16, 20)}-${cleanedId.slice(20)}`;
    
    console.log(`[TRANSCRIPTS] Formatted UUID: ${formattedUuid}`);
    return formattedUuid;
  }
  
  /**
   * Validates the chunk data before inserting into the database
   * @param chunks Array of transcript chunks to validate
   * @throws Error if validation fails
   */
  private validateChunks(chunks: Array<{
    call_id: string;
    created_at: string;
    chunk_index: number;
    transcript_chunk: string;
  }>): void {
    console.log(`[TRANSCRIPTS] Validating ${chunks.length} chunks before database insertion`);
    
    if (!chunks.length) {
      console.warn('[TRANSCRIPTS] No chunks to validate');
      return;
    }
    
    // Check the first chunk to ensure it has the expected structure
    const firstChunk = chunks[0];
    
    // Check if all required fields are present
    if (!firstChunk.call_id) {
      throw new Error('[TRANSCRIPTS] Validation failed: missing call_id in chunk');
    }
    
    if (!firstChunk.created_at) {
      throw new Error('[TRANSCRIPTS] Validation failed: missing created_at in chunk');
    }
    
    if (typeof firstChunk.chunk_index !== 'number') {
      throw new Error(`[TRANSCRIPTS] Validation failed: chunk_index is not a number: ${firstChunk.chunk_index}`);
    }
    
    if (!firstChunk.transcript_chunk) {
      throw new Error('[TRANSCRIPTS] Validation failed: missing transcript_chunk in chunk');
    }
    
    try {
      // Ensure transcript_chunk is a valid JSON string
      JSON.parse(firstChunk.transcript_chunk);
    } catch (e: unknown) {
      throw new Error(`[TRANSCRIPTS] Validation failed: transcript_chunk is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // Validate the structure of all chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      if (!chunk.call_id || !chunk.created_at || typeof chunk.chunk_index !== 'number' || !chunk.transcript_chunk) {
        throw new Error(`[TRANSCRIPTS] Validation failed: invalid structure in chunk at index ${i}`);
      }
    }
    
    console.log('[TRANSCRIPTS] Chunk validation successful');
  }
}
