# Twilio Credentials API

## Create Twilio Account

Creates a new Twilio account configuration.

### Endpoint

```http
POST /api/twilio
```

### Request Body

```json
{
    "accountSID": "your_account_sid",
    "authToken": "your_auth_token",
    "fromNumber": "+1234567890",
    "user_id": "user-uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| accountSID | string | Yes | Twilio Account SID |
| authToken | string | Yes | Twilio Auth Token |
| fromNumber | string | Yes | Twilio Phone Number |
| user_id | string | Yes | UUID of the user |

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": [
        {
            "id": "credential-uuid",
            "account_sid": "your_account_sid",
            "auth_token": "your_auth_token",
            "from_phone_number": "+1234567890",
            "user_id": "user-uuid",
            "created_at": "2025-02-12T13:28:58.621609"
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
```

### Database Schema

The credentials are stored in the `twilio_credentials` table with the following structure:

| Column           | Type      | Description |
|-----------------|-----------|-------------|
| id              | uuid      | Primary key |
| user_id         | uuid      | Foreign key to users table |
| account_sid     | string    | Twilio Account SID |
| auth_token       | string    | Twilio Auth Token |
| from_phone_number| string    | Twilio phone number |
| created_at       | timestamp | Creation timestamp |
