import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { 
  createCorpus, 
  deleteKnowledgebase, 
  getKnowledgebase, 
  getUserKnowledgebases, 
  getSourceUrls, 
  updateKnowledgebase,
  listCorpora 
} from '../controller/corpus.controller';
import { Env } from '../config/env';
import { CorpusService } from '../services/corpus.service';

// Middleware to inject CorpusService
const injectCorpusService = createMiddleware(async (c, next) => {
  const env = c.env;
  const db = c.req.db;
  if (!db) {
    throw new Error('Database client not found in request context');
  }
  const corpusService = CorpusService.getInstance(env, db);
  c.set('corpusService', corpusService);
  await next();
});

const corpusRoutes = new Hono<{ Bindings: Env }>()
  .use('*', injectCorpusService)  // Apply middleware to all routes
  .post('/', createCorpus)
  .get('/:corpusId', getKnowledgebase)
  .get('/', getUserKnowledgebases)  // This will be the default GET endpoint for fetching user's knowledgebases
  .get('/:corpusId/sources', getSourceUrls)
  .patch('/:corpusId', updateKnowledgebase)
  .delete('/:corpusId', deleteKnowledgebase);

export default corpusRoutes;
