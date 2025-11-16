import { Hono } from "hono";
import { createAgent, deleteAgent, getAllAgents, getAgent, updateAgent, syncAgent } from "../controller/agents.controller";
import { Env } from "../config/env";

const agentRoutes = new Hono<{ Bindings: Env }>();

agentRoutes.post('/', createAgent);
agentRoutes.patch('/', updateAgent);
agentRoutes.delete('/', deleteAgent);
agentRoutes.post('/sync', syncAgent); // Manual sync to Ultravox Agent
agentRoutes.get('/:id', getAgent);
agentRoutes.get('/', getAllAgents);

export default agentRoutes;
