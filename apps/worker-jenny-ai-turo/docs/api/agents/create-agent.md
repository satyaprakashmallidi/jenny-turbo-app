# Create Agent API

Creates a new agent.

## Endpoint

```http
POST /api/agent
```

## Request

### Headers
```http
Content-Type: application/json
```

### Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Name of the agent |
| description | string | Yes | Description of the agent |
| voice_id | string | Yes | Voice ID for the agent |
| user_id | string | Yes | UUID of the user who owns the agent |

### Example Request

```json
{
  "name": "Customer Service Bot",
  "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
  "voice_id": "11b9ff7d-3245-4333-a5ae-80457d32e7c3",
  "system_prompt": "You are a helpful customer service agent. Your name is Sarah and you work for TechSupport Inc. Always be polite and professional in your responses."
}
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": {
        "id": "2bd43cf5-52d9-4917-84f3-c5defd82ccc9",
        "created_at": "2025-02-12T13:52:19.887+00:00",
        "voice": "11b9ff7d-3245-4333-a5ae-80457d32e7c3",
        "system_prompt": "You are a helpful customer service agent. Your name is Sarah and you work for TechSupport Inc. Always be polite and professional in your responses.",
        "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
        "name": "Customer Service Bot",
        "is_appointment_booking_allowed": false,
        "appointment_tool_id": null,
        "is_deleted": false
    }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID of the created agent |
| name | string | Name of the agent |
| description | string | Description of the agent |
| voice_id | string | Voice ID for the agent |
| user_id | string | UUID of the user who owns the agent |
| is_deleted | boolean | Soft deletion status |
| created_at | timestamp | Creation timestamp in ISO 8601 format |

### Error Responses

#### Missing Parameters (500 Internal Server Error)
```json
{
  "status": "error",
  "message": "Missing parameters",
  "error": {
    "name": "Customer Service Bot",
    "twilio_from_number": null,
    "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
    "voice_id": null,
    "system_prompt": "You are a helpful customer service agent..."
  }
}
```

#### Ultravox API Error (500 Internal Server Error)
```json
{
  "status": "error",
  "message": "Ultravox API error"
}
```

#### Database Error (500 Internal Server Error)
```json
{
  "status": "error",
  "message": "Internal Server Error",
  "error": {
    // Database error details
  }
}
```