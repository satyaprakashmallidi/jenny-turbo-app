# Get Agent API

Retrieves details of a specific AI agent.

## Endpoint

```http
GET /api/agent/getAgent
```

## Request

### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| id        | string | Yes      | UUID of the agent to retrieve |

### Example Request

```http
GET /api/agent/getAgent?id=ec158318-6f50-44b3-9362-9217c3cf92a2
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": {
        "id": "ec158318-6f50-44b3-9362-9217c3cf92a2",
        "created_at": "2025-02-12T14:10:11.932+00:00",
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

### Error Responses

#### Missing Parameters (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Missing parameters"
}
```

#### Bot Not Found or Deleted (404 Not Found)
```json
{
    "status": "error",
    "message": "Bot not found"
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
