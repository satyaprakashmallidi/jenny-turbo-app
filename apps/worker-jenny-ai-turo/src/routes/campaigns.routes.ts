import { Hono } from "hono";
import {
  createCampaign,
  getCampaigns,
  getCampaign,
  startCampaign,
  stopCampaign,
  updateContact,
  deleteCampaign,
  getCampaignStats,
  updateCampaignSchedule,
  getScheduledCampaigns,
  createCampaignExecution,
  processCallAnswers,
  convertQueuedToNotAnswered
} from "../controller/campaigns.controller";
import { CampaignsService } from "../services/campaigns.service";
import { Env } from "../config/env";

const campaignsRoutes = new Hono<{ Bindings: Env }>();
campaignsRoutes.post("/:campaign_id/convert-queued-to-not-answered", convertQueuedToNotAnswered);

// Campaign management endpoints
campaignsRoutes.post("/", createCampaign);
campaignsRoutes.get("/", getCampaigns);
campaignsRoutes.get("/:campaign_id", getCampaign);
campaignsRoutes.get("/:campaign_id/stats", getCampaignStats);
campaignsRoutes.delete("/:campaign_id", deleteCampaign);

// Campaign control endpoints
campaignsRoutes.post("/:campaign_id/start", startCampaign);
campaignsRoutes.post("/:campaign_id/stop", stopCampaign);

// Campaign scheduling endpoints
campaignsRoutes.put("/:campaign_id/schedule", updateCampaignSchedule);
campaignsRoutes.get("/scheduled", getScheduledCampaigns);
campaignsRoutes.post("/:campaign_id/executions", createCampaignExecution);

// Contact management endpoints
campaignsRoutes.put("/:campaign_id/contacts/:contact_id", updateContact);

// AI processing endpoints
campaignsRoutes.post("/process-answers", processCallAnswers);

// Manual trigger for processing scheduled campaigns (for testing)
campaignsRoutes.post('/process-scheduled', async (c) => {
  try {
    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(c.req.db, c.req.env);
    
    const result = await campaignsService.processScheduledCampaigns();
    
    return c.json({
      status: 'success',
      message: `Processed ${result.processed_count} scheduled campaigns`,
      details: result
    });

  } catch (error) {
    console.error('Process Scheduled Campaigns Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to process scheduled campaigns', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
});

// Test endpoint to check scheduled campaigns due now (for debugging)
campaignsRoutes.get('/debug-scheduled', async (c) => {
  try {
    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(c.req.db, c.req.env);
    
    const scheduledCampaigns = await campaignsService.getScheduledCampaigns(10);
    const currentTime = new Date().toISOString();
    
    return c.json({
      status: 'success',
      current_time: currentTime,
      scheduled_campaigns: scheduledCampaigns,
      campaigns_due: scheduledCampaigns.filter(campaign => 
        campaign.scheduled_start_time && campaign.scheduled_start_time <= currentTime
      )
    });

  } catch (error) {
    console.error('Debug Scheduled Campaigns Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to debug scheduled campaigns', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
});

// Manual endpoint to check and update campaign status
campaignsRoutes.post('/:campaign_id/check-status', async (c) => {
  try {
    const campaign_id = c.req.param('campaign_id');
    
    if (!campaign_id) {
      return c.json({
        status: 'error',
        message: 'Missing campaign_id'
      }, 400);
    }

    const campaignsService = CampaignsService.getInstance();
    campaignsService.setDependencies(c.req.db, c.req.env);
    
    const result = await campaignsService.checkAndUpdateCampaignStatus(campaign_id);
    
    return c.json({
      status: result.success ? 'success' : 'error',
      message: result.message,
      campaign_status: result.status,
      error: result.error
    });

  } catch (error) {
    console.error('Check Campaign Status Error:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to check campaign status', 
      error: error instanceof Error ? error.message : error 
    }, 500);
  }
});

export default campaignsRoutes;