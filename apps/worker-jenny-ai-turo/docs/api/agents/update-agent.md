# Update Agent API

Updates an existing AI agent's configuration.

## Endpoint

```http
POST /api/agent/updateAgent
```

## Request

### Headers
```http
Content-Type: application/json
```

### Body Parameters

| Parameter          | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| id                | string | Yes      | UUID of the agent to update |
| name              | string | Yes      | New name for the agent |
| twilio_from_number| string | Yes      | New Twilio phone number for the agent |
| voice_id          | string | Yes      | New Ultravox voice ID |
| system_prompt     | string | Yes      | New system prompt that defines the agent's behavior |

### Example Request

```json
{
  "name": "Customer Service Bot",
  "twilio_from_number": "updated phone number",
  "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
  "voice_id": "11b9ff7d-3245-4333-a5ae-80457d32e7c3",
  "system_prompt": "Updated the System prompt",
  "id": "2bd43cf5-52d9-4917-84f3-c5defd82ccc9"
}
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": {
        "id": "e84211c8-4c14-42c1-8baf-597878cd5853",
        "created_at": "2025-02-12T13:57:10.894+00:00",
        "phone_number": "updated phone number",
        "voice": "11b9ff7d-3245-4333-a5ae-80457d32e7c3",
        "system_prompt": "Updated the System prompt",
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
| id                        | string    | UUID of the agent |
| created_at                | timestamp | Original creation timestamp (unchanged) |
| phone_number              | string    | Updated Twilio phone number |
| voice                     | string    | Updated Ultravox voice ID |
| system_prompt             | string    | Updated system prompt |
| user_id                   | string    | Owner of the agent (unchanged) |
| name                      | string    | Updated name of the agent |
| is_appointment_booking_allowed | boolean | Whether agent can book appointments |
| appointment_tool_id       | string    | ID of the appointment tool (if enabled) |
| is_deleted               | boolean   | Soft deletion status |

### Error Response (500 Internal Server Error)

```json
{
    "status": "error",
    "message": "Internal Server Error",
    "error": {
        // Database error details
    }
}
```
