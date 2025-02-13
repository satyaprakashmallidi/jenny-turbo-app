# Update Agent API

Updates an existing agent's details.

## Endpoint

```http
PATCH /api/agent
```

## Request

### Headers
```http
Content-Type: application/json
```

### Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | UUID of the agent to update |
| name | string | No | New name for the agent |
| description | string | No | New description for the agent |
| voice_id | string | No | New voice ID for the agent |
| user_id | string | Yes | UUID of the user who owns the agent |

### Example Request

```json
{
  "name": "Customer Service Bot",
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

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID of the agent |
| name | string | Updated name of the agent |
| description | string | Updated description of the agent |
| voice_id | string | Updated voice ID of the agent |
| user_id | string | UUID of the user who owns the agent |
| is_deleted | boolean | Soft deletion status |
| created_at | timestamp | Original creation timestamp |

### Error Responses

#### Bot Not Found (404 Not Found)
```json
{
    "status": "error",
    "message": "Bot with id 2bd43cf5-52d9-4917-84f3-c5defd82ccc9 not found"
}
```

#### Already Deleted (400 Bad Request)
```json
{
    "status": "error",
    "message": "Bot already deleted"
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
```
