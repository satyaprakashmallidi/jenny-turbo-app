# Get All Twilio Accounts API

Retrieves all Twilio account credentials for a specific user.

## Endpoint

```http
GET /api/twilio/getAccounts
```

## Request

### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| user_id   | string | Yes      | The unique identifier of the user whose Twilio credentials to retrieve |

### Example Request

```http
GET /api/twilio/getAccounts?user_id=c99f0ac3-a143-4be9-ad80-3f59cd04d712
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": [
        {
            "id": 27,
            "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
            "account_sid": "12544943215454",
            "auth_token": "msdbfkjhvfkjhwvekjhvkj",
            "from_phone_number": "123456789",
            "created_at": "2025-02-12T11:55:40.860546"
        },
        {
            "id": 28,
            "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
            "account_sid": "abcdefgchnsdkjkj",
            "auth_token": "msdbfkjhvfkjhwvekjhvkj",
            "from_phone_number": "789456123",
            "created_at": "2025-02-12T11:56:16.706613"
        }
        // ... more credentials
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
        // Error details from the database
    }
}
```

## Response Fields

Each credential object in the response array contains:

| Field             | Type      | Description |
|-------------------|-----------|-------------|
| id                | integer   | Unique identifier for the credential record |
| user_id           | string    | The user these credentials belong to |
| account_sid       | string    | Twilio Account SID |
| auth_token        | string    | Twilio Auth Token |
| from_phone_number | string    | Twilio phone number used for making calls |
| created_at        | timestamp | When the credential record was created |
