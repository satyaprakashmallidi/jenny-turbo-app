# Delete Twilio Account API

Deletes a specific Twilio account configuration.

## Endpoint

```http
DELETE /api/twilio/{id}
```

## Request

### Path Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| id        | string | Yes      | UUID of the Twilio account configuration to delete |

### Example Request

```http
DELETE /api/twilio/2bd43cf5-52d9-4917-84f3-c5defd82ccc9
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": [
        {
            "id": 31,
            "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
            "account_sid": "updated accountSID",
            "auth_token": "updated authToken",
            "from_phone_number": "updated phone number",
            "created_at": "2025-02-12T13:31:30.004948"
        }
    ]
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

#### Account Not Found (404 Not Found)
```json
{
    "status": "error",
    "message": "Twilio account not found"
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
