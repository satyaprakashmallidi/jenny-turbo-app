import { Context } from 'hono';
import { CorpusService } from '../services/corpus.service';
import { CreateCorpusRequest, UpdateCorpusRequest } from '../types/corpus';
import { Env } from '../config/env';
import { getEnv } from '../config/env';
import { getSupabaseClient } from '../lib/supabase/client';

export async function createCorpus(c: Context<{ Bindings: Env }>) {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] CREATE_CORPUS: Request received`);
  
  try {
    const { name, description, userId, urls } = await c.req.json<CreateCorpusRequest>();
    console.log(`[CREATE_CORPUS] Input params - name: ${name}, userId: ${userId}, urlCount: ${urls?.length}`);

    if (!userId) {
      console.warn('[CREATE_CORPUS] Request rejected: Missing userId');
      return c.json({ 
        status: 'error', 
        message: 'User ID is required' 
      }, 401);
    }

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      console.warn('[CREATE_CORPUS] Request rejected: Invalid or empty URLs array', urls);
      return c.json({ 
        status: 'error', 
        message: 'At least one URL is required' 
      }, 400);
    }

    console.log('[CREATE_CORPUS] Initializing services...');
    const env = getEnv(c.env);
    const db = getSupabaseClient(env);
    const corpusService = CorpusService.getInstance(env, db);

    console.log('[CREATE_CORPUS] Creating corpus with sources...');
    const result = await corpusService.createCorpusWithSource({
      name,
      description,
      userId,
      urls,
    });

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] CREATE_CORPUS: Successfully created corpus with ID: ${result.id}`);
    return c.json(result);
  } catch (error) {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] CREATE_CORPUS: Error occurred:`, error);
    console.error('[CREATE_CORPUS] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Check if error is about too many corpora
    const errorMessage = error instanceof Error ? error.message : 'Failed to create corpus';
    const statusCode = errorMessage.includes('maximum number of allowed knowledgebase') ? 403 : 500;
    
    return c.json({ 
      status: 'error', 
      message: errorMessage 
    }, statusCode);
  }
}

export async function getKnowledgebase(c: Context<{ Bindings: Env }>) {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] GET_KNOWLEDGEBASE: Request received`);

  try {
    const corpusId = c.req.param('corpusId');
    const userId = c.req.query('userId');
    console.log(`[GET_KNOWLEDGEBASE] Params - corpusId: ${corpusId}, userId: ${userId}`);

    if (!userId) {
      console.warn('[GET_KNOWLEDGEBASE] Request rejected: Missing userId');
      return c.json({ 
        status: 'error', 
        message: 'User ID is required' 
      }, 401);
    }

    console.log('[GET_KNOWLEDGEBASE] Initializing services...');
    const env = getEnv(c.env);
    const db = getSupabaseClient(env);
    const corpusService = CorpusService.getInstance(env, db);

    console.log(`[GET_KNOWLEDGEBASE] Fetching knowledgebase data for corpus: ${corpusId}`);
    const result = await corpusService.getKnowledgebase(corpusId, userId);

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] GET_KNOWLEDGEBASE: Successfully retrieved knowledgebase`);
    return c.json(result);
  } catch (error) {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] GET_KNOWLEDGEBASE: Error occurred:`, error);
    console.error('[GET_KNOWLEDGEBASE] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Failed to get knowledgebase' 
    }, 500);
  }
}

export async function getSourceUrls(c: Context<{ Bindings: Env }>) {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] GET_SOURCE_URLS: Request received`);

  try {
    const corpusId = c.req.param('corpusId');
    const userId = c.req.query('userId');
    console.log(`[GET_SOURCE_URLS] Params - corpusId: ${corpusId}, userId: ${userId}`);

    if (!userId) {
      console.warn('[GET_SOURCE_URLS] Request rejected: Missing userId');
      return c.json({ 
        status: 'error', 
        message: 'User ID is required' 
      }, 401);
    }

    console.log('[GET_SOURCE_URLS] Initializing services...');
    const env = getEnv(c.env);
    const db = getSupabaseClient(env);
    const corpusService = CorpusService.getInstance(env, db);

    console.log(`[GET_SOURCE_URLS] Fetching source URLs for corpus: ${corpusId}`);
    const result = await corpusService.getSourceUrls(corpusId, userId);

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] GET_SOURCE_URLS: Successfully retrieved source URLs. Count: ${result?.length}`);
    return c.json(result);
  } catch (error) {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] GET_SOURCE_URLS: Error occurred:`, error);
    console.error('[GET_SOURCE_URLS] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Failed to get source URLs' 
    }, 500);
  }
}

export async function updateKnowledgebase(c: Context<{ Bindings: Env }>) {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] UPDATE_KNOWLEDGEBASE: Request received`);

  try {
    const corpusId = c.req.param('corpusId');
    const { name, description, userId, urls } = await c.req.json<UpdateCorpusRequest>();
    console.log(`[UPDATE_KNOWLEDGEBASE] Params - corpusId: ${corpusId}, name: ${name}, userId: ${userId}, urlCount: ${urls?.length}`);

    if (!userId) {
      console.warn('[UPDATE_KNOWLEDGEBASE] Request rejected: Missing userId');
      return c.json({ 
        status: 'error', 
        message: 'User ID is required' 
      }, 401);
    }

    console.log('[UPDATE_KNOWLEDGEBASE] Initializing services...');
    const env = getEnv(c.env);
    const db = getSupabaseClient(env);
    const corpusService = CorpusService.getInstance(env, db);

    console.log(`[UPDATE_KNOWLEDGEBASE] Updating knowledgebase: ${corpusId}`);
    const result = await corpusService.updateKnowledgebase(corpusId, {
      name,
      description,
      userId,
      urls,
    });

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] UPDATE_KNOWLEDGEBASE: Successfully updated knowledgebase`);
    return c.json(result);
  } catch (error) {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] UPDATE_KNOWLEDGEBASE: Error occurred:`, error);
    console.error('[UPDATE_KNOWLEDGEBASE] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Failed to update knowledgebase' 
    }, 500);
  }
}

export async function deleteKnowledgebase(c: Context<{ Bindings: Env }>) {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] DELETE_KNOWLEDGEBASE: Request received`);

  try {
    const corpusId = c.req.param('corpusId');
    const userId = c.req.query('userId');
    console.log(`[DELETE_KNOWLEDGEBASE] Params - corpusId: ${corpusId}, userId: ${userId}`);

    if (!userId) {
      console.warn('[DELETE_KNOWLEDGEBASE] Request rejected: Missing userId');
      return c.json({ 
        status: 'error', 
        message: 'User ID is required' 
      }, 401);
    }

    console.log('[DELETE_KNOWLEDGEBASE] Initializing services...');
    const env = getEnv(c.env);
    const db = getSupabaseClient(env);
    const corpusService = CorpusService.getInstance(env, db);

    console.log(`[DELETE_KNOWLEDGEBASE] Deleting knowledgebase: ${corpusId}`);
    await corpusService.deleteKnowledgebase(corpusId, userId);

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] DELETE_KNOWLEDGEBASE: Successfully deleted knowledgebase`);
    return c.json({ 
      status: 'success', 
      message: 'Knowledgebase deleted successfully' 
    });
  } catch (error) {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] DELETE_KNOWLEDGEBASE: Error occurred:`, error);
    console.error('[DELETE_KNOWLEDGEBASE] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Failed to delete knowledgebase' 
    }, 500);
  }
}

export async function listCorpora(c: Context<{ Bindings: Env }>) {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] LIST_CORPORA: Request received`);

  try {
    const userId = c.req.query('userId');

    if (!userId) {
      console.warn('[LIST_CORPORA] Request rejected: Missing userId');
      return c.json({ 
        status: 'error', 
        message: 'User ID is required' 
      }, 401);
    }

    console.log('[LIST_CORPORA] Initializing services...');
    const env = getEnv(c.env);
    const db = getSupabaseClient(env);
    const corpusService = CorpusService.getInstance(env, db);

    console.log('[LIST_CORPORA] Fetching corpora list...');
    const result = await corpusService.listAllCorpora();

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] LIST_CORPORA: Successfully retrieved ${result.results?.length} corpora`);
    return c.json(result);
  } catch (error) {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] LIST_CORPORA: Error occurred:`, error);
    console.error('[LIST_CORPORA] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Failed to list corpora' 
    }, 500);
  }
}

export async function getUserKnowledgebases(c: Context) {
  console.log('[GET_USER_KNOWLEDGEBASES] Request received');
  
  try {
    const userId = c.req.query('userId');
    if (!userId) {
      return c.json({ 
        status: 'error',
        message: 'User ID is required'
      }, 400);
    }

    console.log('[GET_USER_KNOWLEDGEBASES] Fetching knowledgebases for user:', userId);
    const corpusService = c.get('corpusService');
    const knowledgebases = await corpusService.getUserKnowledgebases(userId);

    return c.json({
      status: 'success',
      data: knowledgebases
    });
  } catch (error) {
    console.error('[GET_USER_KNOWLEDGEBASES] Error occurred:', error);
    return c.json({ 
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to fetch user knowledgebases'
    }, 500);
  }
}
