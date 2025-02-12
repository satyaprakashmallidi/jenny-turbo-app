# Update Twilio Account API

Updates an existing Twilio account's credentials.

## Endpoint

```http
PATCH /api/twilio/updateAccount
```

## Request

### Headers
```http
Content-Type: application/json
```

### Body Parameters

| Parameter  | Type    | Required | Description |
|------------|---------|----------|-------------|
| id         | string  | Yes      | The unique identifier of the Twilio credentials record |
| user_id    | string  | Yes      | The unique identifier of the user |
| accountSID | string  | Yes      | The updated Twilio Account SID |
| authToken  | string  | Yes      | The updated Twilio Auth Token |
| fromNumber | string  | Yes      | The updated Twilio phone number |

### Example Request

```json
{
    "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
    "accountSID": "updated accountSID",
    "authToken": "updated authToken",
    "fromNumber": "updated phone number",
    "id": "31"
}
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

