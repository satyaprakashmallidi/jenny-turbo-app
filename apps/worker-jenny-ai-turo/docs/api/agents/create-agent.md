# Create Agent API

Creates a new AI agent with specified voice and system prompt.

## Endpoint

```http
POST /api/agent/createAgent
```

## Request

### Headers
```http
Content-Type: application/json
```

### Body Parameters

| Parameter          | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| name              | string | Yes      | Name of the agent |
| twilio_from_number| string | Yes      | Twilio phone number to be used by the agent |
| user_id           | string | Yes      | The unique identifier of the user creating the agent |
| voice_id          | string | Yes      | Ultravox voice ID to be used by the agent |
| system_prompt     | string | Yes      | System prompt that defines the agent's behavior and personality |

### Example Request

```json
{
  "name": "Customer Service Bot",
  "twilio_from_number": "+13103402765",
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
        "phone_number": "+13103402765",
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

| Field                      | Type      | Description |
|---------------------------|-----------|-------------|
| id                        | string    | UUID of the created agent |
| created_at                | timestamp | Creation timestamp in ISO 8601 format |
| phone_number              | string    | Twilio phone number in E.164 format |
| voice                     | string    | Ultravox voice ID |
| system_prompt             | string    | The prompt that defines agent's behavior |
| user_id                   | string    | Owner of the agent |
| name                      | string    | Name of the agent |
| is_appointment_booking_allowed | boolean | Whether agent can book appointments |
| appointment_tool_id       | string    | ID of the appointment tool (if enabled) |
| is_deleted               | boolean   | Soft deletion status |

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