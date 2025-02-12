# Update Twilio Account API

Updates an existing Twilio account configuration.

## Endpoint

```http
PATCH /api/twilio/{id}
```

## Request

### Headers
```http
Content-Type: application/json
```

### Path Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| id        | string | Yes      | UUID of the Twilio account configuration to update |

### Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| accountSID | string | Yes | Updated Twilio Account SID |
| authToken | string | Yes | Updated Twilio Auth Token |
| fromNumber | string | Yes | Updated Twilio Phone Number |
| user_id | string | Yes | UUID of the user who owns the account |

### Example Request

```json
{
    "accountSID": "updated_account_sid",
    "authToken": "updated_auth_token",
    "fromNumber": "+1234567890",
    "user_id": "user-uuid"
}
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": {
        "id": "2bd43cf5-52d9-4917-84f3-c5defd82ccc9",
        "account_sid": "updated_account_sid",
        "auth_token": "updated_auth_token",
        "from_phone_number": "+1234567890",
        "user_id": "user-uuid",
        "created_at": "2025-02-12T13:28:58.621609"
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

#### Database Error (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Internal Server Error",
    "error": {
        // Supabase error details
    }
}
