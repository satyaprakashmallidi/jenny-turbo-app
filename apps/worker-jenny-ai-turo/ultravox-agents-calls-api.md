# Ultravox Agents & Calls API - Complete Endpoint Reference

## Base URL
```
https://api.ultravox.ai/api
```

## Authentication
All endpoints require the `X-API-Key` header with your API key:
```
X-API-Key: your-api-key
```

---

# AGENTS API ENDPOINTS

## 1. LIST AGENTS
**Retrieve all agents with pagination and filtering support**

### Endpoint
```
GET /agents
```

### Method
```
GET
```

### Query Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `cursor` | string | Pagination cursor value for navigating results | No |
| `limit` | integer | Number of results per page (default varies) | No |
| `search` | string | Search string to filter agents by name/properties | No |
| `ordering` | string | Field to use for ordering results | No |

### Request Example
```bash
curl --request GET \
  --url 'https://api.ultravox.ai/api/agents?limit=10&search=support' \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "next": "http://api.example.org/accounts/?cursor=cD00ODY%3D",
  "previous": "http://api.example.org/accounts/?cursor=cj0xJnA9NDg3",
  "results": [
    {
      "agentId": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
      "publishedRevisionId": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
      "name": "Customer Support Agent",
      "created": "2023-11-07T05:31:56Z",
      "callTemplate": {
        "name": "Support Template",
        "created": "2023-11-07T05:31:56Z",
        "updated": "2023-11-07T05:31:56Z",
        "medium": {
          "webRtc": {},
          "twilio": {},
          "serverWebSocket": {
            "inputSampleRate": 16000,
            "outputSampleRate": 16000,
            "clientBufferSizeMs": 100
          }
        },
        "systemPrompt": "You are a helpful customer support agent...",
        "temperature": 0.7,
        "model": "fixie-ai/ultravox",
        "voice": "default-voice",
        "recordingEnabled": true,
        "selectedTools": [],
        "statistics": {
          "calls": 150
        }
      }
    }
  ],
  "total": 25
}
```

---

## 2. CREATE AGENT
**Create a new voice agent with specified configuration**

### Endpoint
```
POST /agents
```

### Method
```
POST
```

### Headers
```
Content-Type: application/json
X-API-Key: <api-key>
```

### Request Body
```json
{
  "name": "Customer Support Agent",
  "callTemplate": {
    "systemPrompt": "You are Anna, a friendly customer support agent. Help customers with their questions.",
    "temperature": 0.7,
    "model": "fixie-ai/ultravox",
    "voice": "default-voice",
    "recordingEnabled": true,
    "medium": {
      "webRtc": {}
    },
    "selectedTools": [
      {
        "toolName": "knowledgebaseLookup",
        "descriptionOverride": "Search our product documentation"
      }
    ]
  }
}
```

### Request Example
```bash
curl --request POST \
  --url https://api.ultravox.ai/api/agents \
  --header 'X-API-Key: <api-key>' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "Sales Agent",
    "callTemplate": {
      "systemPrompt": "You are a sales representative...",
      "temperature": 0.5,
      "model": "fixie-ai/ultravox",
      "voice": "professional"
    }
  }'
```

### Response (201 - application/json)
```json
{
  "agentId": "new-agent-id-12345",
  "publishedRevisionId": "new-agent-id-12345",
  "name": "Sales Agent",
  "created": "2025-11-16T10:30:00Z",
  "callTemplate": {
    "name": "Sales Template",
    "created": "2025-11-16T10:30:00Z",
    "updated": "2025-11-16T10:30:00Z",
    "systemPrompt": "You are a sales representative...",
    "temperature": 0.5,
    "model": "fixie-ai/ultravox",
    "voice": "professional",
    "recordingEnabled": false
  }
}
```

---

## 3. GET AGENT (By ID)
**Retrieve a specific agent by its ID**

### Endpoint
```
GET /agents/{agent_id}
```

### Method
```
GET
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `agent_id` | string | The unique identifier of the agent | Yes |

### Request Example
```bash
curl --request GET \
  --url https://api.ultravox.ai/api/agents/3c90c3cc-0d44-4b50-8888-8dd25736052a \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "agentId": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
  "publishedRevisionId": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
  "name": "Customer Support Agent",
  "created": "2023-11-07T05:31:56Z",
  "callTemplate": {
    "name": "Support Template",
    "created": "2023-11-07T05:31:56Z",
    "updated": "2023-11-07T05:31:56Z",
    "systemPrompt": "You are a customer support agent...",
    "temperature": 0.7,
    "model": "fixie-ai/ultravox",
    "voice": "friendly",
    "recordingEnabled": true,
    "statistics": {
      "calls": 500
    }
  }
}
```

---

## 4. UPDATE AGENT
**Update an existing agent's configuration**

### Endpoint
```
PATCH /agents/{agent_id}
```

### Method
```
PATCH
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `agent_id` | string | The unique identifier of the agent | Yes |

### Headers
```
Content-Type: application/json
X-API-Key: <api-key>
```

### Request Body (Partial Update)
```json
{
  "name": "Updated Agent Name",
  "callTemplate": {
    "systemPrompt": "Updated system prompt...",
    "temperature": 0.4
  }
}
```

### Request Example
```bash
curl --request PATCH \
  --url https://api.ultravox.ai/api/agents/3c90c3cc-0d44-4b50-8888-8dd25736052a \
  --header 'X-API-Key: <api-key>' \
  --header 'Content-Type: application/json' \
  --data '{
    "callTemplate": {
      "systemPrompt": "Updated support message...",
      "temperature": 0.5
    }
  }'
```

### Response (200 - application/json)
```json
{
  "agentId": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
  "publishedRevisionId": "updated-revision-id",
  "name": "Customer Support Agent",
  "created": "2023-11-07T05:31:56Z",
  "callTemplate": {
    "updated": "2025-11-16T11:00:00Z",
    "systemPrompt": "Updated support message...",
    "temperature": 0.5
  }
}
```

### Note
Agent changes only affect **new calls**. Active/ongoing calls will continue using the configuration they started with.

---

## 5. DELETE AGENT
**Delete an agent permanently**

### Endpoint
```
DELETE /agents/{agent_id}
```

### Method
```
DELETE
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `agent_id` | string | The unique identifier of the agent to delete | Yes |

### Request Example
```bash
curl --request DELETE \
  --url https://api.ultravox.ai/api/agents/3c90c3cc-0d44-4b50-8888-8dd25736052a \
  --header 'X-API-Key: <api-key>'
```

### Response (204)
**No response body** - Returns 204 No Content on successful deletion

---

## 6. LIST AGENT CALLS
**Retrieve all calls created using a specific agent**

### Endpoint
```
GET /agents/{agent_id}/calls
```

### Method
```
GET
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `agent_id` | string | The unique identifier of the agent | Yes |

### Query Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `cursor` | string | Pagination cursor value | No |
| `limit` | integer | Number of results per page | No |

### Request Example
```bash
curl --request GET \
  --url 'https://api.ultravox.ai/api/agents/3c90c3cc-0d44-4b50-8888-8dd25736052a/calls?limit=20' \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "next": "http://api.example.org/accounts/?cursor=cD00ODY%3D",
  "previous": "http://api.example.org/accounts/?cursor=cj0xJnA9NDg3",
  "results": [
    {
      "callId": "call-123456",
      "clientVersion": "1.0",
      "created": "2025-11-16T10:00:00Z",
      "joined": "2025-11-16T10:00:05Z",
      "ended": "2025-11-16T10:15:30Z",
      "endReason": "hangup",
      "billedDuration": "900s",
      "firstSpeaker": "FIRST_SPEAKER_AGENT",
      "model": "fixie-ai/ultravox",
      "recordingEnabled": true,
      "systemPrompt": "You are a customer support agent...",
      "temperature": 0.7,
      "voice": "friendly",
      "transcriptOptional": false,
      "errorCount": 0,
      "shortSummary": "Customer asked about billing",
      "summary": "Customer called about billing issues...",
      "metadata": {
        "customerId": "cust-789"
      }
    }
  ],
  "total": 45
}
```

---

# CALLS API ENDPOINTS

## 1. CREATE CALL WITH AGENT
**Start a new call using an existing agent with optional parameter overrides**

### Endpoint
```
POST /agents/{agent_id}/calls
```

### Method
```
POST
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `agent_id` | string | The unique identifier of the agent to use for the call | Yes |

### Headers
```
Content-Type: application/json
X-API-Key: <api-key>
```

### Request Body
```json
{
  "templateContext": {
    "customerName": "Jane Smith",
    "accountType": "Premium"
  },
  "metadata": {
    "source": "website",
    "sessionId": "sess-12345"
  },
  "maxDuration": "900s",
  "recordingEnabled": false,
  "initialMessages": [],
  "firstSpeakerSettings": {
    "agent": {
      "text": "Hello! How can I help you today?"
    }
  }
}
```

### Request Example
```bash
curl --request POST \
  --url https://api.ultravox.ai/api/agents/3c90c3cc-0d44-4b50-8888-8dd25736052a/calls \
  --header 'X-API-Key: <api-key>' \
  --header 'Content-Type: application/json' \
  --data '{
    "templateContext": {
      "customerName": "John Doe",
      "accountType": "Basic"
    },
    "metadata": {
      "source": "mobile_app"
    }
  }'
```

### Response (201 - application/json)
```json
{
  "callId": "call-new-12345",
  "clientVersion": "1.0",
  "created": "2025-11-16T11:30:00Z",
  "joined": null,
  "ended": null,
  "endReason": null,
  "billedDuration": "0s",
  "firstSpeaker": "FIRST_SPEAKER_AGENT",
  "model": "fixie-ai/ultravox",
  "recordingEnabled": false,
  "systemPrompt": "You are a helpful customer support agent...",
  "temperature": 0.7,
  "voice": "friendly",
  "transcriptOptional": false,
  "errorCount": 0,
  "metadata": {
    "source": "mobile_app"
  },
  "agentId": "3c90c3cc-0d44-4b50-8888-8dd25736052a"
}
```

### Override Parameters (optional in request body)
| Parameter | Type | Description |
|-----------|------|-------------|
| `templateContext` | object | Variables for template substitution (e.g., customer name, account type) |
| `initialMessages` | array | Conversation history to start from |
| `metadata` | object | Custom key-value pairs for tracking (strings only, no keys starting with "ultravox.") |
| `maxDuration` | string | Override max call duration (e.g., "900s" for 15 minutes) |
| `recordingEnabled` | boolean | Override recording settings |
| `medium` | object | Communication medium (webRtc, twilio, etc.) |
| `joinTimeout` | string | Timeout for joining the call |
| `firstSpeakerSettings` | object | Initial speaker configuration |
| `initialOutputMedium` | string | Start with voice or text ("MESSAGE_MEDIUM_VOICE" or "MESSAGE_MEDIUM_TEXT") |
| `dataConnection` | object | WebSocket configuration for data messages |
| `experimentalSettings` | object | Experimental features |

---

## 2. CREATE DIRECT CALL (Without Agent)
**Create a call directly with custom parameters (without using a saved agent)**

### Endpoint
```
POST /calls
```

### Method
```
POST
```

### Headers
```
Content-Type: application/json
X-API-Key: <api-key>
```

### Query Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `priorCallId` | string | UUID of a prior call to continue from (reuses history & settings) | No |
| `greeting` | boolean | Add a prompt for greeting if no initial message exists | No |

### Request Body
```json
{
  "systemPrompt": "You are a helpful customer service agent. Your name is Alex.",
  "temperature": 0.7,
  "model": "fixie-ai/ultravox",
  "voice": "friendly",
  "recordingEnabled": true,
  "selectedTools": [],
  "metadata": {
    "campaignId": "camp-123"
  },
  "medium": {
    "webRtc": {}
  },
  "firstSpeaker": "FIRST_SPEAKER_AGENT",
  "initialOutputMedium": "MESSAGE_MEDIUM_VOICE"
}
```

### Request Example
```bash
curl --request POST \
  --url https://api.ultravox.ai/api/calls \
  --header 'X-API-Key: <api-key>' \
  --header 'Content-Type: application/json' \
  --data '{
    "systemPrompt": "You are a sales representative selling premium subscriptions.",
    "temperature": 0.5,
    "model": "fixie-ai/ultravox",
    "voice": "professional",
    "recordingEnabled": true
  }'
```

### Response (201 - application/json)
```json
{
  "callId": "call-direct-12345",
  "clientVersion": "1.0",
  "created": "2025-11-16T11:45:00Z",
  "joined": null,
  "ended": null,
  "endReason": null,
  "billedDuration": "0s",
  "firstSpeaker": "FIRST_SPEAKER_AGENT",
  "model": "fixie-ai/ultravox",
  "recordingEnabled": true,
  "systemPrompt": "You are a sales representative selling premium subscriptions.",
  "temperature": 0.5,
  "voice": "professional",
  "transcriptOptional": false,
  "errorCount": 0,
  "metadata": {}
}
```

### Continue from Prior Call Example
```bash
curl --request POST \
  --url 'https://api.ultravox.ai/api/calls?priorCallId=call-prev-12345' \
  --header 'X-API-Key: <api-key>' \
  --header 'Content-Type: application/json' \
  --data '{
    "systemPrompt": "Continue the previous conversation with updated context...",
    "metadata": {
      "continuation": "true",
      "originalCall": "call-prev-12345"
    }
  }'
```

---

## 3. LIST ALL CALLS
**Retrieve all calls with advanced filtering and pagination**

### Endpoint
```
GET /calls
```

### Method
```
GET
```

### Query Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `agentIds` | array | Filter calls by specific agent IDs | No |
| `cursor` | string | Pagination cursor value | No |
| `limit` | integer | Number of results per page | No |
| `search` | string | Search string to filter call summaries | No |
| `ordering` | string | Field to order results by | No |
| `createdAfter` | date | Start date (inclusive) for call creation filter (YYYY-MM-DD) | No |
| `createdBefore` | date | End date (inclusive) for call creation filter (YYYY-MM-DD) | No |
| `minDuration` | string | Minimum call duration filter (e.g., "60s") | No |
| `maxDuration` | string | Maximum call duration filter (e.g., "900s") | No |
| `voiceIds` | array | Filter calls by voice IDs | No |
| `metadata` | object | Filter by metadata key-value pairs (e.g., metadata.source=website) | No |

### Request Example
```bash
curl --request GET \
  --url 'https://api.ultravox.ai/api/calls?limit=20&agentIds=agent-123&createdAfter=2025-11-01' \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "next": "http://api.example.org/calls/?cursor=cD00ODY%3D",
  "previous": "http://api.example.org/calls/?cursor=cj0xJnA9NDg3",
  "results": [
    {
      "callId": "call-123456",
      "clientVersion": "1.0",
      "created": "2025-11-16T10:00:00Z",
      "joined": "2025-11-16T10:00:05Z",
      "ended": "2025-11-16T10:15:30Z",
      "endReason": "hangup",
      "billedDuration": "900s",
      "firstSpeaker": "FIRST_SPEAKER_AGENT",
      "model": "fixie-ai/ultravox",
      "recordingEnabled": true,
      "systemPrompt": "You are a customer support agent...",
      "temperature": 0.7,
      "voice": "friendly",
      "transcriptOptional": false,
      "errorCount": 0,
      "shortSummary": "Customer asked about billing",
      "summary": "Customer called asking about their monthly billing...",
      "metadata": {
        "customerId": "cust-789",
        "source": "website"
      },
      "agentId": "agent-123"
    }
  ],
  "total": 245
}
```

---

## 4. GET CALL (By ID)
**Retrieve details of a specific call**

### Endpoint
```
GET /calls/{call_id}
```

### Method
```
GET
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `call_id` | string | The unique identifier of the call | Yes |

### Request Example
```bash
curl --request GET \
  --url https://api.ultravox.ai/api/calls/call-123456 \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "callId": "call-123456",
  "clientVersion": "1.0",
  "created": "2025-11-16T10:00:00Z",
  "joined": "2025-11-16T10:00:05Z",
  "ended": "2025-11-16T10:15:30Z",
  "endReason": "hangup",
  "billedDuration": "900s",
  "firstSpeaker": "FIRST_SPEAKER_AGENT",
  "model": "fixie-ai/ultravox",
  "recordingEnabled": true,
  "systemPrompt": "You are a customer support agent...",
  "temperature": 0.7,
  "voice": "friendly",
  "transcriptOptional": false,
  "errorCount": 0,
  "shortSummary": "Customer asked about billing",
  "summary": "Customer called with billing questions. Provided information about recent charges.",
  "metadata": {
    "customerId": "cust-789"
  },
  "agentId": "agent-123",
  "inactivityMessages": [
    {
      "duration": "60s",
      "message": "Are you still there?"
    }
  ],
  "vadSettings": {
    "turnEndpointDelay": "500ms",
    "minimumTurnDuration": "200ms"
  }
}
```

---

## 5. LIST CALL MESSAGES
**Get all messages exchanged during a specific call**

### Endpoint
```
GET /calls/{call_id}/messages
```

### Method
```
GET
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `call_id` | string | The unique identifier of the call | Yes |

### Query Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `cursor` | string | Pagination cursor value | No |
| `limit` | integer | Number of results per page | No |
| `scope` | string | Filter message scope: "last_stage" (default) or "in_call" (all stages) | No |

### Request Example
```bash
curl --request GET \
  --url 'https://api.ultravox.ai/api/calls/call-123456/messages?limit=50&scope=in_call' \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "next": "http://api.example.org/calls/call-123456/messages/?cursor=cD00ODY%3D",
  "previous": null,
  "results": [
    {
      "role": "agent",
      "text": "Hello! How can I help you today?",
      "timestamp": "2025-11-16T10:00:05Z",
      "duration": "2.5s"
    },
    {
      "role": "user",
      "text": "I have a question about my billing.",
      "timestamp": "2025-11-16T10:00:10Z",
      "duration": "3.2s"
    },
    {
      "role": "agent",
      "text": "Of course! I'd be happy to help with your billing question.",
      "timestamp": "2025-11-16T10:00:15Z",
      "duration": "2.8s"
    }
  ],
  "total": 28
}
```

---

## 6. GET CALL RECORDING
**Retrieve the audio recording for a call**

### Endpoint
```
GET /calls/{call_id}/recording
```

### Method
```
GET
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `call_id` | string | The unique identifier of the call | Yes |

### Request Example
```bash
curl --request GET \
  --url https://api.ultravox.ai/api/calls/call-123456/recording \
  --header 'X-API-Key: <api-key>' \
  --output recording.wav
```

### Response (200)
**Audio file** (WAV or PCM format depending on configuration)

**Headers:**
- `Content-Type: audio/wav` or `audio/x-raw`
- `Content-Length: <size>`

### Response (404)
```json
{
  "error": "Recording not found",
  "callId": "call-123456"
}
```

---

## 7. GET CALL TRANSCRIPT
**Retrieve the transcript for a call**

### Endpoint
```
GET /calls/{call_id}/transcript
```

### Method
```
GET
```

### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `call_id` | string | The unique identifier of the call | Yes |

### Request Example
```bash
curl --request GET \
  --url https://api.ultravox.ai/api/calls/call-123456/transcript \
  --header 'X-API-Key: <api-key>'
```

### Response (200 - application/json)
```json
{
  "callId": "call-123456",
  "transcript": [
    {
      "speaker": "agent",
      "text": "Hello! How can I help you today?",
      "timestamp": 5000
    },
    {
      "speaker": "user",
      "text": "I have a question about my billing.",
      "timestamp": 10000
    }
  ]
}
```

---

# COMMON RESPONSE FIELDS

## Agent Object Fields
```json
{
  "agentId": "unique-agent-identifier",
  "publishedRevisionId": "revision-id",
  "name": "Agent display name",
  "created": "ISO-8601 timestamp",
  "callTemplate": {
    "name": "template-name",
    "created": "ISO-8601 timestamp",
    "updated": "ISO-8601 timestamp",
    "systemPrompt": "System instructions for the agent",
    "temperature": 0.7,
    "model": "fixie-ai/ultravox",
    "voice": "voice-name",
    "recordingEnabled": true/false,
    "medium": {
      "webRtc": {},
      "twilio": {},
      "serverWebSocket": {}
    },
    "selectedTools": [],
    "statistics": {
      "calls": 123
    }
  }
}
```

## Call Object Fields
```json
{
  "callId": "unique-call-identifier",
  "created": "ISO-8601 timestamp",
  "joined": "ISO-8601 timestamp or null",
  "ended": "ISO-8601 timestamp or null",
  "endReason": "hangup|agent_hangup|timeout|connection_error|system_error|unjoined",
  "billedDuration": "duration in seconds as string (e.g., '900s')",
  "firstSpeaker": "FIRST_SPEAKER_AGENT|FIRST_SPEAKER_USER",
  "model": "AI model name",
  "voice": "voice-id",
  "recordingEnabled": true/false,
  "systemPrompt": "Agent system prompt",
  "temperature": 0.5,
  "shortSummary": "Brief call summary (2-3 sentences)",
  "summary": "Detailed call summary",
  "metadata": {
    "customKey": "customValue"
  },
  "agentId": "agent-id-if-agent-was-used",
  "errorCount": 0
}
```

## Message Object Fields
```json
{
  "role": "agent|user",
  "text": "Message content",
  "timestamp": "ISO-8601 timestamp",
  "duration": "duration in seconds as string (e.g., '2.5s')"
}
```

---

# COMMUNICATION MEDIUMS

## Supported Mediums
- **webRtc**: WebRTC for direct browser connections (default)
- **twilio**: Twilio voice integration
- **serverWebSocket**: Server-based WebSocket connection
- **telnyx**: Telnyx carrier integration
- **plivo**: Plivo voice service
- **exotel**: Exotel integration
- **sip**: SIP protocol for VoIP

## Medium Configuration Example
```json
{
  "medium": {
    "webRtc": {
      "dataMessages": {
        "pong": true,
        "state": true,
        "transcript": true
      }
    }
  }
}
```

---

# VOICE PROVIDERS (externalVoice)

- **elevenLabs**: Eleven Labs TTS with voice customization
- **cartesia**: Cartesia voice synthesis with emotion control
- **lmnt**: LMNT voice provider
- **google**: Google Cloud Text-to-Speech
- **playHt**: PlayHT voice service
- **generic**: Custom TTS endpoint

---

# ERROR RESPONSES

## 400 Bad Request
```json
{
  "error": "Invalid request parameters",
  "details": "..."
}
```

## 401 Unauthorized
```json
{
  "error": "Invalid or missing API key"
}
```

## 404 Not Found
```json
{
  "error": "Resource not found",
  "resource": "agent|call|message"
}
```

## 429 Too Many Requests
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

## 500 Server Error
```json
{
  "error": "Internal server error"
}
```

---

# RATE LIMITS

Check response headers for rate limit information:
- `X-RateLimit-Limit`: Maximum requests per period
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Timestamp when limit resets

---

# BEST PRACTICES

1. **Always include error handling** for network and rate limit errors
2. **Use pagination** for large result sets with cursor-based navigation
3. **Cache agent configurations** to reduce API calls
4. **Implement retry logic** with exponential backoff
5. **Monitor call statistics** to track agent usage
6. **Test agents thoroughly** before production deployment
7. **Use descriptive names** for agent management
8. **Store IDs** (agentId, callId) for future reference
9. **Handle timestamps** as ISO-8601 format
10. **Document custom tools** and their parameters
11. **For calls, always check `endReason`** to understand call termination
12. **Use `metadata`** for tracking and correlating calls with your system
13. **Leverage `templateContext`** to pass dynamic data to agents
14. **Monitor `errorCount`** in calls to detect issues
15. **Set appropriate `maxDuration`** to control call costs

