# Get Twilio Account API

Retrieves details of a specific Twilio account's credentials.

## Endpoint

```http
GET /api/twilio/getAccount
```

## Request

### Query Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| id        | string | Yes      | The unique identifier of the Twilio credentials record to retrieve |

### Example Request

```http
GET /api/twilio/getAccount?id=30
```

## Response

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": {
        "id": 30,
        "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
        "account_sid": "12544943215454",
        "auth_token": "wregwretwetwewerft",
        "from_phone_number": "123456789",
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
        // Error details from the database
    }
}
