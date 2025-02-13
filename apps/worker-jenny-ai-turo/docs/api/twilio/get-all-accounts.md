# Get All Twilio Accounts API

Retrieves all Twilio account configurations for a specific user.

## Endpoint

```http
GET /api/twilios
```

### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| user_id   | string | Yes      | UUID of the user whose Twilio accounts to retrieve |

### Example Request

```http
GET /api/twilios?user_id=user-uuid
```

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": [
        {
            "id": "2bd43cf5-52d9-4917-84f3-c5defd82ccc9",
            "account_sid": "your_account_sid",
            "auth_token": "your_auth_token",
            "from_phone_number": "+1234567890",
            "user_id": "user-uuid",
            "created_at": "2025-02-12T13:28:58.621609"
        },
        {
            "id": "3ce54df6-63ea-5028-95g4-d6efge93ddd0",
            "account_sid": "another_account_sid",
            "auth_token": "another_auth_token",
            "from_phone_number": "+0987654321",
            "user_id": "user-uuid",
            "created_at": "2025-02-12T14:28:58.621609"
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

#### Database Error (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Internal Server Error",
    "error": {
        // Supabase error details
    }
}
