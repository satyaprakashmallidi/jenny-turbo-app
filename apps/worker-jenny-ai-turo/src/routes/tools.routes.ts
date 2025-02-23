import { Hono } from "hono";
import { createTool, deactivateTool, deleteTool, getAllTools, getTool, updateTool } from "../controller/tools.controller";
import { Env } from "../config/env";

const toolRoutes = new Hono<{ Bindings: Env }>();

toolRoutes.post('/', createTool);
toolRoutes.get('/', getAllTools);
toolRoutes.get('/:toolId', getTool);
toolRoutes.delete('/:toolId/deactivate', deactivateTool);
toolRoutes.patch('/:toolId', updateTool);
toolRoutes.delete('/:toolId', deleteTool);

export default toolRoutes;
