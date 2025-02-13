# Delete Agent API

Deletes a specific agent.

## Endpoint

```http
DELETE /api/agent/{id}
```

## Request

### Path Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| id        | string | Yes      | UUID of the agent to delete |

### Example Request

```http
DELETE /api/agent/2bd43cf5-52d9-4917-84f3-c5defd82ccc9
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
        "is_deleted": true
    }
}
```

### Error Responses

#### Bot Not Found (404 Not Found)
```json
{
    "status": "error",
    "message": "Bot with id {id} not found"
}
```

#### Already Deleted (400 Bad Request)
```json
{
    "status": "error",
    "message": "Bot with id {id} already deleted"
}
```

#### Database Error (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Internal Server Error",
    "error": {
        // Supabase error details
    }
}
