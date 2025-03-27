import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCallTranscripts } from '../controller/call-transcripts.controller';
import { Env } from '../config/env';
import { CallTranscriptsService } from '../services/call-transcripts.service';

// Middleware to inject CallTranscriptsService
const injectCallTranscriptsService = createMiddleware(async (c, next) => {
  const env = c.env;
  const db = c.req.db;
  if (!db) {
    throw new Error('Database client not found in request context');
  }
  const callTranscriptsService = CallTranscriptsService.getInstance(env, db);
  c.set('callTranscriptsService', callTranscriptsService);
  await next();
});

const callTranscriptsRoutes = new Hono<{ Bindings: Env }>()
  .use('*', injectCallTranscriptsService)  // Apply middleware to all routes
  .get('/:callId', getCallTranscripts);  // Get transcript for a specific call

export default callTranscriptsRoutes; 