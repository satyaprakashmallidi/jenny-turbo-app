# Get All Agents API

Retrieves all agents for a specific user.

## Endpoint

```http
GET /api/agents
```

## Request

### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| user_id   | string | Yes      | UUID of the user whose agents to retrieve |

### Example Request

```http
GET /api/agents?user_id=c99f0ac3-a143-4be9-ad80-3f59cd04d712
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": [
        {
            "id": "ec158318-6f50-44b3-9362-9217c3cf92a2",
            "created_at": "2025-02-12T14:10:11.932+00:00",
            "voice": "11b9ff7d-3245-4333-a5ae-80457d32e7c3",
            "system_prompt": "You are a helpful customer service agent...",
            "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
            "name": "Customer Service Bot",
            "is_appointment_booking_allowed": false,
            "appointment_tool_id": null,
            "is_deleted": false
        }
    ]
}

### Error Responses

#### Missing Parameters (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Missing parameters"
}

#### Database Error (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Internal Server Error",
    "error": {
        // Supabase error details
    }
}
```
