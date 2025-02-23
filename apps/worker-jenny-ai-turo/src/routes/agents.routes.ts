import { Hono } from "hono";
import { createAgent, deleteAgent, getAllAgents, getAgent, updateAgent } from "../controller/agents.controller";
import { Env } from "../config/env";

const agentRoutes = new Hono<{ Bindings: Env }>();

agentRoutes.post('/', createAgent);
agentRoutes.patch('/', updateAgent);
agentRoutes.delete('/', deleteAgent);
agentRoutes.get('/:id', getAgent);
agentRoutes.get('/', getAllAgents);

export default agentRoutes;
