import axios from 'axios';
import { SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import { Corpus, CorpusSource, CreateCorpusRequest, UpdateCorpusRequest, KnowledgebaseData, SourceUrlsResponse } from '../types/corpus';

export class CorpusService {
  private static instance: CorpusService;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly env: Env;
  private readonly db: SupabaseClient;

  private constructor(env: Env, db: SupabaseClient) {
    this.env = env;
    this.db = db;
    this.apiKey = env.ULTRAVOX_API_KEY;
    this.baseUrl = env.ULTRAVOX_API_URL || 'https://api.ultravox.ai/api';
  }

  public static getInstance(env: Env, db: SupabaseClient): CorpusService {
    if (!CorpusService.instance) {
      CorpusService.instance = new CorpusService(env, db);
    }
    return CorpusService.instance;
  }

  private readonly supportedDocTypes = {
    include: {
      mimeTypes: [
        'text/html',
        'text/plain',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/json',
        'text/markdown',
        'text/csv',
        'application/jsonl',
        'application/jsonl.gz',
        'application/jsonl.bz2',
        'application/jsonl.zip',
        'application/jsonl.tar',
        'application/jsonl.tar.gz',
        'application/jsonl.tar.bz2',
        'text/tab-separated-values',
        'text/tab-separated-values.gz',
        'text/tab-separated-values.bz2',
        'text/tab-separated-values.zip',
        'text/tab-separated-values.tar',
        'text/tab-separated-values.tar.gz',
        'text/tab-separated-values.tar.bz2',
      ]
    },
    exclude: {
      mimeTypes: [] // Add any mime types you want to explicitly exclude
    }
  };

  // Optimized RAG parameters based on best practices
  private readonly ragConfig = {
    chunkSize: 512, // Optimal for most content types while maintaining context
    chunkOverlap: 50, // ~10% overlap to maintain context between chunks
    maxVectors: 10000, // Reasonable limit for most use cases
    maxDocs: 1000, // Reasonable limit for document management
    maxDocumentBytes: 10485760, // 10MB limit per document
    embeddingDimension: 1536, // Standard for OpenAI embeddings
    similarityMetric: 'cosine', // Most effective for semantic search
    minRelevanceScore: 0.7 // Good balance between recall and precision
  };

  private mapSourceStatus(ultravoxStatus: string): 'processing' | 'ready' | 'error' {
    switch (ultravoxStatus) {
      case 'SOURCE_STATUS_READY':
        return 'ready';
      case 'SOURCE_STATUS_INITIALIZING':
      case 'SOURCE_STATUS_UPDATING':
        return 'processing';
      default:
        return 'error';
    }
  }

  public async listAllCorpora(): Promise<{
    results: Array<{
      corpusId: string;
      created: string;
      name: string;
      description: string;
      stats: {
        status: string;
        lastUpdated: string;
        numChunks: number;
        numDocs: number;
        numVectors: number;
      };
    }>;
    next: string | null;
    previous: string | null;
    total: number;
  }> {
    try {
      const response = await axios.get(`${this.baseUrl}/corpora`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });
      console.log('Ultravox corpora list response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('Failed to list corpora:', error);
      throw error;
    }
  }

  public async deleteAllCorpora(): Promise<void> {
    try {
      // List all corpora
      const corporaList = await this.listAllCorpora();
      console.log('Deleting all corpora:', JSON.stringify(corporaList.results, null, 2));

      // Delete each corpus
      for (const corpus of corporaList.results) {
        try {
          await axios.delete(`${this.baseUrl}/corpora/${corpus.corpusId}`, {
            headers: {
              'X-API-Key': this.apiKey,
              'Content-Type': 'application/json'
            }
          });
          console.log(`Successfully deleted corpus: ${corpus.name} (${corpus.corpusId})`);
        } catch (error) {
          console.error(`Failed to delete corpus ${corpus.name}:`, error);
        }
      }

      // Clean up our database records
      const { error } = await this.db
        .from('knowledgebase_sources')
        .delete()
        .neq('source_id', '00000000-0000-0000-0000-000000000000'); // Delete all records
      
      if (error) {
        console.error('Failed to clean up knowledgebase_sources:', error);
      }

      const { error: kbError } = await this.db
        .from('knowledgebase')
        .delete()
        .neq('corpus_id', '00000000-0000-0000-0000-000000000000'); // Delete all records

      if (kbError) {
        console.error('Failed to clean up knowledgebase:', kbError);
      }

    } catch (error) {
      console.error('Failed to delete all corpora:', error);
      throw error;
    }
  }

  async createCorpus(request: Omit<CreateCorpusRequest, 'urls'>): Promise<any> {
    try {
      // First delete all existing corpora for development
      await this.deleteAllCorpora();
      
      // Add a unique suffix to prevent name conflicts
      const uniqueName = `${request.name}-${request.userId.slice(0, 8)}`;
      console.log(`Creating corpus with name: ${uniqueName}`);

      const response = await axios.post(
        `${this.baseUrl}/corpora`,
        {
          name: uniqueName,
          description: request.description,
        },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Ultravox API Error Details:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        }, error.response?.data);
        
        if (error.response?.status === 409) {
          throw new Error(`A corpus with name "${request.name}" already exists. Please try a different name.`);
        }
        throw new Error(`Ultravox API error: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to create corpus: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createCorpusSource(corpusId: string, request: any): Promise<any> {
    try {
      console.log(`Creating source for corpus ${corpusId} with config:`, {
        name: request.name,
        urls: request.loadSpec.startUrls
      });

      const response = await axios.post(
        `${this.baseUrl}/corpora/${corpusId}/sources`,
        {
          corpusId,
          name: request.name,
          description: request.description,
          loadSpec: {
            maxDocuments: this.ragConfig.maxDocs,
            maxDocumentBytes: this.ragConfig.maxDocumentBytes,
            relevantDocumentTypes: this.supportedDocTypes,
            startUrls: request.loadSpec.startUrls,
            maxDepth: 3 // is set currently but while testing, can be changed
          }
        },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      if (axios?.isAxiosError(error)) {
        console.error('Ultravox API Source Creation Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
        throw new Error(`Ultravox API error: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to create corpus source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createCorpusWithSource(request: CreateCorpusRequest): Promise<{ corpusId: string; message: string }> {
    try {
      // Check if corpus already exists for this user
      const { data: existingCorpus } = await this.db
        .from('knowledgebase')
        .select('corpus_id')
        .eq('user_id', request.userId)
        .eq('name', request.name)
        .single();

      if (existingCorpus) {
        throw new Error('A knowledgebase with this name already exists for this user');
      }

      // Create corpus first
      const { name, description, userId, urls } = request;
      const corpus = await this.createCorpus({
        name,
        description,
        userId
      });

      const corpusId = corpus?.corpusId;
      if (!corpusId) {
        throw new Error('Failed to get corpus ID from response');
      }

      // Create source with the corpus ID
      const source = await this.createCorpusSource(corpusId, {
        name: `${request.name} Source`,
        description: `Source for ${request.name}`,
        loadSpec: {
          type: 'web',
          startUrls: urls,
          maxDepth: 3,
          maxDocuments: this.ragConfig.maxDocs,
          maxDocumentBytes: this.ragConfig.maxDocumentBytes,
          relevantDocumentTypes: this.supportedDocTypes
        }
      });

      const sourceId = source?.sourceId;
      if (!sourceId) {
        throw new Error('Failed to get source ID from response');
      }

      const now = new Date().toISOString();

      // Store corpus in knowledgebase table
      const { error: knowledgebaseError } = await this.db
        .from('knowledgebase')
        .insert({
          corpus_id: corpusId,
          user_id: userId,
          name: name,
          description: description,
          created_at: now,
          updated_at: now
        });
      
      if (knowledgebaseError) {
        console.error('Failed to store knowledgebase:', {
          error: knowledgebaseError,
          message: knowledgebaseError.message,
          details: knowledgebaseError.details,
          hint: knowledgebaseError.hint
        });
        throw new Error(`Failed to store knowledgebase: ${knowledgebaseError.message}`);
      }

      // Store source in knowledgebase_sources table
      const { error: sourceError } = await this.db
        .from('knowledgebase_sources')
        .insert({
          source_id: sourceId,
          corpus_id: corpusId,
          source_urls: urls,
          created_at: now,
          updated_at: now
        });

      if (sourceError) {
        console.error('Failed to store knowledgebase source:', {
          error: sourceError,
          message: sourceError.message,
          details: sourceError.details,
          hint: sourceError.hint
        });
        throw new Error(`Failed to store knowledgebase source: ${sourceError.message}`);
      }

      return {
        corpusId,
        message: 'Corpus and source created successfully'
      };
    } catch (error) {
      if (axios?.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;
        
        if (status === 409) {
          throw new Error(`A corpus with this name already exists. Please choose a different name. Details: ${message}`);
        }
        throw new Error(`Ultravox API error: ${message}`);
      }

      // Log the full error object for debugging
      console.error('Failed to create corpus with source:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      throw new Error(`Failed to create corpus with source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getKnowledgebase(corpusId: string, userId: string): Promise<any> {
    try {
      // Get knowledgebase details from Supabase
      const { data: knowledgebase, error: knowledgebaseError } = await this.db
        .from('knowledgebase')
        .select(`
          *,
          knowledgebase_sources(*)
        `)
        .eq('corpus_id', corpusId)
        .eq('user_id', userId)
        .single();

      if (knowledgebaseError) {
        throw new Error(`Failed to fetch knowledgebase: ${knowledgebaseError.message}`);
      }

      if (!knowledgebase) {
        throw new Error('Knowledgebase not found');
      }

      return knowledgebase;
    } catch (error) {
      throw new Error(`Failed to get knowledgebase: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getSourceUrls(corpusId: string, userId: string): Promise<SourceUrlsResponse> {
    try {
      // First check if user has access to this corpus and get source details
      const { data: knowledgebase, error: knowledgebaseError } = await this.db
        .from('knowledgebase')
        .select('*, knowledgebase_sources(*)')
        .eq('corpus_id', corpusId)
        .eq('user_id', userId)
        .single();

      if (knowledgebaseError || !knowledgebase) {
        throw new Error('Knowledgebase not found or access denied');
      }

      // Get source details from Ultravox
      const sourceResponse = await axios.get(
        `${this.baseUrl}/corpora/${corpusId}/sources/${knowledgebase.knowledgebase_sources.source_id}`,
        {
          headers: {
            'X-API-Key': this.apiKey,
          },
        }
      );

      const sourceData = sourceResponse.data;

      // Return only the necessary information
      return {
        name: knowledgebase.name,
        description: knowledgebase.description,
        urls: knowledgebase.knowledgebase_sources.source_urls,
        status: this.mapSourceStatus(sourceData.stats.status),
        lastUpdated: sourceData.stats.lastUpdated,
        totalDocuments: sourceData.stats.numDocs
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Ultravox API error: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to get source URLs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateKnowledgebase(corpusId: string, request: UpdateCorpusRequest): Promise<KnowledgebaseData> {
    try {
      // First check if user has access to this corpus
      const { data: knowledgebase, error: knowledgebaseError } = await this.db
        .from('knowledgebase_sources')
        .select('*')
        .eq('corpus_id', corpusId)
        .single();

      if (knowledgebaseError || !knowledgebase) {
        throw new Error('Knowledgebase not found or access denied', {
          cause: knowledgebaseError
        });
      }

      const sourceId = knowledgebase.source_id;

      // First try to get the current source details to see what we're working with
      console.log("=============> Fetching current source details...");
      let sourceDetails;
      try {
        const sourceResponse = await axios.get(
          `${this.baseUrl}/corpora/${corpusId}/sources/${sourceId}`,
          {
            headers: {
              'X-API-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
          }
        );
        sourceDetails = sourceResponse.data;
        console.log("=============> Current source details:", JSON.stringify(sourceDetails, null, 2));

        // Check if source is currently updating and wait for it
        if (sourceDetails.stats.status === "SOURCE_STATUS_UPDATING") {
          const lastUpdated = new Date(sourceDetails.stats.lastUpdated);
          const timeSinceUpdate = Math.floor((Date.now() - lastUpdated.getTime()) / 1000 / 60); // minutes
          throw new Error(
            `Cannot update the knowledgebase at this time. The source is currently processing ${sourceDetails.loadSpec.startUrls.length} documents ` +
            `(started ${timeSinceUpdate} minutes ago). Please try again after the current processing is complete.`
          );
        }

      } catch (error) {
        console.error("=============> Failed to fetch source details:", {
          status: axios.isAxiosError(error) ? error.response?.status : undefined,
          data: axios.isAxiosError(error) ? error.response?.data : undefined,
          message: error instanceof Error ? error.message : error
        });
        throw error;
      }

      interface UpdatePayload {
        name?: string;
        description?: string;
        loadSpec: {
          startUrls: string[];
          maxDocuments: number;
          maxDocumentBytes: number;
          maxDepth: number;
          relevantDocumentTypes: {
            include: {
              mimeTypes: string[];
            };
            exclude: {
              mimeTypes: string[];
            };
          };
        };
      }

      const updateData: UpdatePayload = {
        loadSpec: {
          startUrls: request.urls || sourceDetails.loadSpec.startUrls, // Keep existing URLs if none provided
          maxDocuments: request.maxDocuments || sourceDetails.loadSpec.maxDocuments,
          maxDocumentBytes: request.maxDocumentBytes || sourceDetails.loadSpec.maxDocumentBytes,
          maxDepth: request.maxDepth || sourceDetails.loadSpec.maxDepth,
          relevantDocumentTypes: this.supportedDocTypes
        }
      };

      if (request.name) {
        updateData.name = request.name;
      }
      if (request.description !== undefined) {
        updateData.description = request.description;
      }

      console.log("=============> Sending update request with payload:", JSON.stringify(updateData, null, 2));
      console.log("=============> Request URL:", `${this.baseUrl}/corpora/${corpusId}/sources/${sourceId}`);
      console.log("=============> Request headers:", {
        'X-API-Key': 'REDACTED',
        'Content-Type': 'application/json'
      });

      try {
        const response = await axios.patch(
          `${this.baseUrl}/corpora/${corpusId}/sources/${sourceId}`,
          updateData,
          {
            headers: {
              'X-API-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log("=============> Update response:", {
          status: response.status,
          statusText: response.statusText,
          data: response.data
        });

        if (request.urls) {
          await this.db
            .from('knowledgebase_sources')
            .update({ source_urls: request.urls })
            .eq('corpus_id', corpusId);
        }

        return this.getKnowledgebase(corpusId, request.userId);
      } catch (error) {
        console.error("=============> Update request failed:", {
          status: axios.isAxiosError(error) ? error.response?.status : undefined,
          statusText: axios.isAxiosError(error) ? error.response?.statusText : undefined,
          data: axios.isAxiosError(error) ? error.response?.data : undefined,
          headers: axios.isAxiosError(error) ? error.response?.headers : undefined,
          message: error instanceof Error ? error.message : error
        });
        throw new Error(`Failed to update knowledgebase: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } catch (error: unknown) {
      console.error("=============> Error details:", {
        message: error instanceof Error ? error.message : error,
        response: axios.isAxiosError(error) ? error.response?.data : undefined,
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Failed to update knowledgebase: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deleteKnowledgebase(corpusId: string, userId: string): Promise<void> {
    try {
      try {
        await axios.delete(
          `${this.baseUrl}/corpora/${corpusId}`,
          {
            headers: {
              'X-API-Key': this.apiKey,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        console.error('Failed to delete corpus from Ultravox:', error);
        throw error;
      }

      // No need to check database since tables don't exist yet
      console.log('Successfully deleted corpus from Ultravox');
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Ultravox API error: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to delete knowledgebase: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getUserKnowledgebases(userId: string) {
    try {
      // Get all knowledgebases for the user with their sources
      const { data: knowledgebases, error } = await this.db
        .from('knowledgebase')
        .select(`
          *,
          knowledgebase_sources (*)
        `)
        .eq('user_id', userId);

      if (error) {
        console.error('Failed to fetch user knowledgebases:', error);
        throw error;
      }

      // Also fetch the corpus details from Ultravox for each knowledgebase
      const ultravoxDetails = await Promise.all(
        knowledgebases.map(async (kb) => {
          try {
            const response = await axios.get(`${this.baseUrl}/corpora/${kb.corpus_id}`, {
              headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
              }
            });
            return {
              ...kb,
              ultravox_details: response.data
            };
          } catch (error) {
            console.error(`Failed to fetch Ultravox details for corpus ${kb.corpus_id}:`, error);
            return {
              ...kb,
              ultravox_details: null
            };
          }
        })
      );

      return ultravoxDetails;
    } catch (error) {
      console.error('Failed to get user knowledgebases:', error);
      throw error;
    }
  }
}
