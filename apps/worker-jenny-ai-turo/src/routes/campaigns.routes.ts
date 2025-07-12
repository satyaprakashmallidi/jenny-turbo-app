import { Hono } from "hono";
import { 
  createCampaign, 
  getCampaigns, 
  getCampaign, 
  startCampaign, 
  stopCampaign, 
  updateContact,
  deleteCampaign,
  getCampaignStats
} from "../controller/campaigns.controller";
import { Env } from "../config/env";

const campaignsRoutes = new Hono<{ Bindings: Env }>();

// Campaign management endpoints
campaignsRoutes.post("/", createCampaign);
campaignsRoutes.get("/", getCampaigns);
campaignsRoutes.get("/:campaign_id", getCampaign);
campaignsRoutes.get("/:campaign_id/stats", getCampaignStats);
campaignsRoutes.delete("/:campaign_id", deleteCampaign);

// Campaign control endpoints
campaignsRoutes.post("/:campaign_id/start", startCampaign);
campaignsRoutes.post("/:campaign_id/stop", stopCampaign);

// Contact management endpoints
campaignsRoutes.put("/:campaign_id/contacts/:contact_id", updateContact);

export default campaignsRoutes;