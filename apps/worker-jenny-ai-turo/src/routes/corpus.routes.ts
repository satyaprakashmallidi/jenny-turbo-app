import { Hono } from 'hono';
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

const corpusRoutes = new Hono<{ Bindings: Env }>()
  .post('/', createCorpus)
  .get('/:corpusId', getKnowledgebase)
  .get('/', getUserKnowledgebases)  // This will be the default GET endpoint for fetching user's knowledgebases
  .get('/:corpusId/sources', getSourceUrls)
  .patch('/:corpusId', updateKnowledgebase)
  .delete('/:corpusId', deleteKnowledgebase);

export default corpusRoutes;
