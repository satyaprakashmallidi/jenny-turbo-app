import { Context } from "hono";
import { randomUUID } from "crypto";

/**
 * POST /queue-call
 * Body: { ...call payload... }
 * Returns: { job_id }
 */
export async function queueCall(c: Context) {
  try {
    const payload = await c.req.json();
    const job_id = randomUUID();
    const env = c.req.env;
    // Only enqueue job, do not store in DB
    console.log("Payload", payload);
    // await env.calls_que.send({ job_id, payload });
    return c.json({ status: 'success', job_id });
  } catch (error) {
    console.error('Queue Call Error:', error);
    return c.json({ status: 'error', message: 'Failed to queue call', error: error instanceof Error ? error.message : error }, 500);
  }
}

/**
 * GET /queue-call-status?job_id=...
 * Returns: { status, callId, ... }
 */
export async function queueCallStatus(c: Context) {
  try {
    const job_id = c.req.query('job_id');
    if (!job_id) {
      return c.json({ status: 'error', message: 'Missing job_id' }, 400);
    }
    const db = c.req.db;
    const { data, error } = await db.from('call_jobs').select('*').eq('job_id', job_id).single();
    if (error || !data) {
      return c.json({ status: 'error', message: 'Job not found', error }, 404);
    }
    return c.json({ status: 'success', job: data });
  } catch (error) {
    console.error('Queue Call Status Error:', error);
    return c.json({ status: 'error', message: 'Failed to fetch job status', error: error instanceof Error ? error.message : error }, 500);
  }
} 