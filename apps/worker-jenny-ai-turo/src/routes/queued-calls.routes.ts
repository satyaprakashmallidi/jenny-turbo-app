import { Hono } from "hono";
import { queueCall, queueCallStatus } from "../controller/queued-calls.controller";
import { Env } from "../config/env";

const queuedCallsRoutes = new Hono<{ Bindings: Env }>();

queuedCallsRoutes.post("/queue-call", queueCall);
queuedCallsRoutes.get("/queue-call-status", queueCallStatus);

export default queuedCallsRoutes; 