# Jenny AI Turo Backend API

A powerful Cloudflare Workers-based backend for the Jenny AI voice conversation platform, featuring real-time transcription, call management, and intelligent voice interactions powered by Ultravox and Twilio.

## 🚀 Overview

Jenny AI Turo provides enterprise-grade voice conversation capabilities with:
- **Real-time voice calls** via Twilio and Ultravox integration
- **Live transcription** with automatic storage and retrieval
- **Campaign management** for automated outbound calling
- **Webhook system** for real-time event notifications
- **Knowledge base integration** for intelligent responses
- **Tool integration** for dynamic conversation workflows

## 🏗️ Architecture

Built on **Cloudflare Workers** with:
- **Hono** - High-performance web framework
- **Supabase** - PostgreSQL database and authentication
- **Ultravox** - Voice AI and real-time transcription
- **Twilio** - Enterprise telephony services

### Base URL
```
https://jenny-ai-turo.everyai-com.workers.dev
```

## 📋 Core Features

### 🎙️ Voice Calls & Transcripts
- Inbound/outbound call handling via Twilio
- Real-time transcription using Ultravox API
- Automatic transcript chunking and database storage
- Call recording and AI-generated summaries

### 📊 Campaign Management
- Automated outbound calling campaigns
- Contact management and call status tracking
- Time window restrictions and intelligent retry logic
- Number locking for concurrent call prevention

### 🔗 Webhook System
- Event-driven notifications for call lifecycle
- Support for `call.started`, `call.joined`, `call.ended` events
- Secure webhook validation with secret keys

### 🛠️ Tool Integration
- Dynamic tool creation and management
- Custom parameter validation and schemas
- HTTP endpoint integration for external services

## 📚 API Documentation

### Authentication
All endpoints require proper authentication via Supabase client. Include your user ID in request bodies or query parameters.

---

## 🎯 Core Call Management

### Start Inbound Call
```http
GET /api/inbound?user_id={id}&bot_id={id}&CallSid={sid}&AccountSid={sid}
```
Initiates an inbound call with the specified bot configuration.

**Response:** TwiML XML for call connection
```xml
<Response>
  <Connect>
    <Stream url="wss://ultravox-stream-url"/>
  </Connect>
</Response>
```

### Get Call Details
```http
GET /api/get-call-details?call_id={id}
```
Retrieves comprehensive call information including AI-generated summaries.

**Response:**
```json
{
  "status": "success",
  "data": {
    "call_id": "uuid-string",
    "created": "2024-01-01T00:00:00Z",
    "joined": "2024-01-01T00:00:30Z",
    "ended": "2024-01-01T00:05:00Z",
    "end_reason": "user_hangup",
    "recording_enabled": true,
    "short_summary": "Customer inquiry about pricing",
    "long_summary": "Detailed conversation summary...",
    "voice": "voice-id",
    "temperature": 0.5
  }
}
```

### Create Ultravox Call
```http
POST /api/ultravox/createcall
Content-Type: application/json

{
  "voice": "voice-id",
  "temperature": 0.6,
  "systemPrompt": "You are a helpful assistant",
  "metadata": {
    "botId": "bot-id",
    "userId": "user-id"
  }
}
```

---

## 📝 Transcripts API

### Get Real-time Call Transcript
```http
GET /api/call-transcripts/{callId}?pageSize=100&cursor=string
```
Fetches real-time call transcripts with automatic database storage.

**Parameters:**
- `callId` (required) - The Ultravox call identifier
- `pageSize` (optional) - Messages per page (default: 100, max: 200)
- `cursor` (optional) - Pagination cursor for next page

**Response:**
```json
{
  "status": "success",
  "data": {
    "results": [
      {
        "role": "user",
        "text": "Hello, I need help with my account",
        "medium": "voice",
        "callStageId": "stage-uuid",
        "callStageMessageIndex": 0
      },
      {
        "role": "assistant",
        "text": "I'd be happy to help you with your account. What specific issue are you experiencing?",
        "medium": "voice",
        "callStageId": "stage-uuid",
        "callStageMessageIndex": 1
      }
    ],
    "next": "cursor-for-next-page",
    "previous": null,
    "total": 50
  }
}
```

### Get Paginated Transcript (Database)
```http
GET /api/transcript?call_id={id}&cursor={offset}&limit=20
```
Alternative transcript endpoint with database-first approach and caching.

**Response:**
```json
{
  "messages": [...],
  "hasMore": true,
  "nextCursor": "10"
}
```

---

## 🔗 Webhooks API

Manage webhook endpoints for real-time call event notifications.

### List User Webhooks
```http
GET /api/webhooks/user?user_id={id}
```

### Create Webhook
```http
POST /api/webhooks
Content-Type: application/json

{
  "user_id": "user-uuid",
  "url": "https://your-endpoint.com/webhook",
  "events": ["call.started", "call.joined", "call.ended"],
  "agent_id": "optional-agent-id"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "webhookId": "webhook-uuid",
    "url": "https://your-endpoint.com/webhook",
    "events": ["call.started", "call.joined", "call.ended"],
    "status": "normal",
    "created": "2024-01-01T00:00:00Z",
    "secrets": ["whsec_32characterstring..."]
  }
}
```

### Update Webhook
```http
PATCH /api/webhooks/{webhook_id}
Content-Type: application/json

{
  "user_id": "user-uuid",
  "url": "https://new-endpoint.com/webhook",
  "events": ["call.ended"]
}
```

### Delete Webhook
```http
DELETE /api/webhooks/{webhook_id}?user_id={id}
```

### Get Specific Webhook
```http
GET /api/webhooks/{webhook_id}?user_id={id}
```

---

## 🔔 Webhook Events

Your webhook endpoint will receive POST requests for subscribed events:

### Call Started Event
```json
{
  "event": "call.started",
  "callId": "call-uuid",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "userId": "user-uuid",
    "botId": "bot-uuid",
    "phoneNumber": "+1234567890",
    "direction": "inbound"
  }
}
```

### Call Joined Event
```json
{
  "event": "call.joined",
  "callId": "call-uuid",
  "timestamp": "2024-01-01T00:00:30Z",
  "data": {
    "joinedAt": "2024-01-01T00:00:30Z",
    "participantType": "user"
  }
}
```

### Call Ended Event
```json
{
  "event": "call.ended",
  "callId": "call-uuid",
  "timestamp": "2024-01-01T00:05:00Z",
  "data": {
    "endReason": "user_hangup",
    "duration": 270,
    "recordingUrl": "https://recordings.example.com/call.mp3",
    "shortSummary": "Customer inquiry resolved",
    "longSummary": "Customer called regarding billing issue. Provided account details and resolved payment discrepancy. Customer satisfied with resolution.",
    "transcriptAvailable": true
  }
}
```

---

## 🏢 Twilio Account Management

### Account Endpoints

#### Create Twilio Account
```http
POST /api/twilio/account
Content-Type: application/json

{
  "account_sid": "AC1234567890abcdef",
  "auth_token": "your-auth-token",
  "account_name": "Production Account",
  "user_id": "user-uuid"
}
```

#### Get All Accounts
```http
GET /api/twilio/accounts
Content-Type: application/json

{
  "user_id": "user-uuid"
}
```

#### Update Account
```http
PATCH /api/twilio/account/{id}
Content-Type: application/json

{
  "account_name": "Updated Name",
  "user_id": "user-uuid"
}
```

### Phone Number Management

#### Add Phone Number
```http
POST /api/twilio/phone-number
Content-Type: application/json

{
  "account_id": "8",
  "friendly_name": "Customer Service Line",
  "phone_number": "+1234567890",
  "user_id": "user-uuid"
}
```

#### Update Phone Number
```http
PATCH /api/twilio/phone-number/{id}
Content-Type: application/json

{
  "friendly_name": "Updated Name",
  "phone_number": "+1234567890",
  "user_id": "user-uuid"
}
```

---

## 🤖 Bot & Agent Management

### Create Agent
```http
POST /api/agent
Content-Type: application/json

{
  "name": "Customer Service Bot",
  "user_id": "user-uuid",
  "voice_id": "voice-uuid",
  "system_prompt": "You are a helpful customer service representative. Always be polite and professional.",
  "temperature": 70,
  "is_appointment_booking_allowed": true,
  "knowledge_base_id": "kb-uuid"
}
```

### Get All Agents
```http
GET /api/agents?user_id={id}
```

### Make Outbound Call
```http
POST /api/twilio/call
Content-Type: application/json

{
  "bot_id": "bot-uuid",
  "to_number": "+1234567890",
  "from_number": "+0987654321",
  "user_id": "user-uuid",
  "placeholders": {
    "name": "John Doe",
    "company": "Acme Corp"
  }
}
```

---

## 🛠️ Tools Management

### Create Tool
```http
POST /api/tools?user_id={id}
Content-Type: application/json

{
  "name": "AppointmentBookingTool",
  "definition": {
    "modelToolName": "bookAppointment",
    "description": "Books appointments for customers",
    "dynamicParameters": [
      {
        "name": "appointmentDetails",
        "location": "PARAMETER_LOCATION_BODY",
        "schema": {
          "type": "object",
          "properties": {
            "appointmentType": {
              "type": "string",
              "enum": ["consultation", "follow_up", "urgent"]
            },
            "preferredDate": {
              "type": "string",
              "format": "date"
            },
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "email": {"type": "string", "format": "email"}
          },
          "required": ["appointmentType", "preferredDate", "firstName", "lastName", "email"]
        },
        "required": true
      }
    ],
    "http": {
      "baseUrlPattern": "https://your-api.com/appointments",
      "httpMethod": "POST"
    },
    "timeout": "20s"
  }
}
```

### Get All Tools
```http
GET /api/tools?user_id={id}
```

---

## 📊 Campaign Management

### Create Campaign
```http
POST /api/campaigns
Content-Type: application/json

{
  "campaign_name": "Q1 Marketing Outreach",
  "user_id": "user-uuid",
  "bot_id": "bot-uuid",
  "contacts": [
    {
      "name": "John Doe",
      "phone": "+1234567890",
      "email": "john@example.com"
    }
  ],
  "schedule_time": "2024-01-01T10:00:00Z",
  "time_window": {
    "start": "09:00",
    "end": "17:00"
  },
  "timezone": "America/New_York",
  "settings": {
    "enableNumberLocking": true,
    "maxRetries": 3,
    "retryDelay": 300
  }
}
```

### Get Campaign Status
```http
GET /api/campaigns/{campaign_id}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "campaign_id": "campaign-uuid",
    "status": "in_progress",
    "total_contacts": 100,
    "completed_calls": 75,
    "failed_calls": 5,
    "pending_calls": 20,
    "success_rate": 75.0
  }
}
```

### Debug Campaign
```http
GET /api/debug-campaign/{campaign_id}
```
Detailed campaign analytics including contact status breakdown and troubleshooting information.

---

## 🔧 Utility Endpoints

### Get Available Voices
```http
GET /api/voices
```

**Response:**
```json
{
  "status": "success",
  "data": [
    {
      "voiceId": "voice-uuid",
      "name": "Sarah (Professional)",
      "previewUrl": "https://audio-preview-url.mp3"
    }
  ]
}
```

### Set Twilio Webhook
```http
POST /api/set-twilio-webhook
Content-Type: application/json

{
  "voice_url": "https://your-worker.workers.dev/api/inbound",
  "account_sid": "AC1234567890abcdef",
  "auth_token": "your-auth-token",
  "phone_number_sid": "+1234567890"
}
```

### Capture Real-time Data
```http
POST /api/capture-outcome
Content-Type: application/json

{
  "callId": "call-uuid",
  "customerName": "John Doe",
  "issueResolved": true,
  "followUpRequired": false,
  "satisfactionScore": 9
}
```

---

## 🔐 Security & Configuration

### Environment Variables
```env
ULTRAVOX_API_KEY=your_ultravox_api_key
ULTRAVOX_API_URL=https://api.ultravox.ai/api
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Database Schema
The API requires these Supabase tables:
- `bots` - Bot configurations and settings
- `call_records` - Call metadata and tracking
- `call_transcripts` - Chunked transcript storage
- `call_campaign_contacts` - Campaign contact management
- `ultravox_webhooks` - Webhook configurations
- `twilio_account` - Twilio account management
- `tools` - Custom tool definitions

### Security Features
- **Row Level Security (RLS)** on all database tables
- **Webhook signature validation** using HMAC-SHA256
- **Rate limiting** and concurrent call prevention
- **Input validation** with Zod schemas
- **CORS protection** and request sanitization

---

## ⚡ Performance & Monitoring

### Optimizations
- **Transcript chunking** (10 messages per chunk) for efficient storage
- **Voice data caching** (1-hour TTL) for faster responses
- **Background processing** via Cloudflare Queues
- **Connection pooling** for database operations
- **Exponential backoff** for retry logic

### Monitoring
- **Structured logging** with operation tracking
- **Error handling** with proper HTTP status codes
- **Database query optimization** and performance monitoring
- **Webhook delivery status** tracking and failure analysis

---

## 🚀 Development & Deployment

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
```

### Testing Examples

#### Test Transcript Retrieval
```bash
curl "https://jenny-ai-turo.everyai-com.workers.dev/api/call-transcripts/your-call-id" \
  -H "Authorization: Bearer your-token"
```

#### Test Webhook Creation
```bash
curl -X POST "https://jenny-ai-turo.everyai-com.workers.dev/api/webhooks" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-uuid",
    "url": "https://your-app.com/webhook",
    "events": ["call.ended"]
  }'
```

#### Test Campaign Creation
```bash
curl -X POST "https://jenny-ai-turo.everyai-com.workers.dev/api/campaigns" \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_name": "Test Campaign",
    "user_id": "user-uuid",
    "bot_id": "bot-uuid",
    "contacts": [{"name": "Test User", "phone": "+1234567890"}]
  }'
```

---

## 🎯 Integration Examples

### Frontend Integration
```javascript
// Initialize transcript fetching
const getTranscript = async (callId) => {
  const response = await fetch(`/api/call-transcripts/${callId}?pageSize=50`);
  const data = await response.json();
  return data.data.results;
};

// Setup webhook for real-time events
const createWebhook = async (url, events) => {
  const response = await fetch('/api/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: currentUserId,
      url,
      events
    })
  });
  return response.json();
};

// Start outbound call
const makeCall = async (botId, toNumber, fromNumber) => {
  const response = await fetch('/api/twilio/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bot_id: botId,
      to_number: toNumber,
      from_number: fromNumber,
      user_id: currentUserId
    })
  });
  return response.json();
};
```

### Webhook Handler Example (Express.js)
```javascript
const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// Webhook signature validation
const validateWebhook = (req, res, next) => {
  const signature = req.headers['x-jenny-signature'];
  const payload = JSON.stringify(req.body);
  const secret = process.env.JENNY_WEBHOOK_SECRET;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  if (signature !== `sha256=${expectedSignature}`) {
    return res.status(401).send('Invalid signature');
  }

  next();
};

// Handle webhook events
app.post('/webhook', validateWebhook, (req, res) => {
  const { event, callId, data } = req.body;

  switch(event) {
    case 'call.started':
      console.log(`📞 Call ${callId} started for user ${data.userId}`);
      // Initialize call tracking, setup UI, etc.
      break;

    case 'call.joined':
      console.log(`🎤 User joined call ${callId}`);
      // Update UI to show active call status
      break;

    case 'call.ended':
      console.log(`📞 Call ${callId} ended: ${data.endReason}`);
      console.log(`📝 Summary: ${data.shortSummary}`);

      // Process call results
      if (data.transcriptAvailable) {
        fetchAndProcessTranscript(callId);
      }

      // Update CRM, send notifications, etc.
      break;
  }

  res.status(200).send('OK');
});

const fetchAndProcessTranscript = async (callId) => {
  const response = await fetch(`https://jenny-ai-turo.everyai-com.workers.dev/api/call-transcripts/${callId}`);
  const transcript = await response.json();

  // Process transcript data
  transcript.data.results.forEach(message => {
    console.log(`${message.role}: ${message.text}`);
  });
};

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

---

## 📞 Support & Resources

### Documentation Structure
- **Type Definitions**: `/src/types/` - TypeScript interfaces
- **Service Layer**: `/src/services/` - Business logic implementation
- **Controllers**: `/src/controller/` - Request handling
- **Routes**: `/src/routes/` - API endpoint definitions

### Key Features Summary
✅ **Real-time transcription** with chunked storage
✅ **Campaign automation** with intelligent retry logic
✅ **Webhook system** for event-driven integrations
✅ **Tool integration** for custom workflows
✅ **Multi-tenant architecture** with user isolation
✅ **Enterprise security** with RLS and validation
✅ **Performance optimization** with caching and queues

Built with ❤️ using **Cloudflare Workers**, **Ultravox**, **Twilio**, and **Supabase**.

---

*For additional support or feature requests, please refer to the codebase documentation or contact the development team.*