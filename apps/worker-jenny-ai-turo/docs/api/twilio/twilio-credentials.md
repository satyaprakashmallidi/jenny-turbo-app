# Twilio Credentials API Documentation

## Create Twilio Account Credentials

Creates new Twilio account credentials for a user.

### Endpoint

```
PUT /api/twilio/createAccount
```

### Request

#### Headers
```
Content-Type: application/json
```

#### Body Parameters

| Parameter  | Type   | Required | Description |
|------------|--------|----------|-------------|
| user_id    | string | Yes      | The unique identifier of the user |
| accountSID | string | Yes      | The Twilio Account SID |
| authToken  | string | Yes      | The Twilio Auth Token |
| fromNumber | string | Yes      | The Twilio phone number to be used for making calls |

#### Example Request Body
```json
{
  "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
  "accountSID": "12544943215454",
  "authToken": "wregwretwetwewerft",
  "fromNumber": "123456789"
}
```

### Response

#### Success Response (200 OK)

```json
{
    "status": "success",
    "data": [
        {
            "id": 29,
            "user_id": "c99f0ac3-a143-4be9-ad80-3f59cd04d712",
            "account_sid": "12544943215454",
            "auth_token": "wregwretwetwewerft",
            "from_phone_number": "123456789",
            "created_at": "2025-02-12T13:22:05.455357"
        }
    ]
}
```

#### Error Response (500 Internal Server Error)

##### Missing Parameters
```json
{
    "status": "error",
    "message": "Missing parameters"
}
```

##### Internal Server Error
```json
{
    "status": "error",
    "message": "Internal Server Error",
    "error": {
        // Error details
    }
}
```

### Database Schema

The credentials are stored in the `twilio_credentials` table with the following structure:

| Column            | Type      | Description |
|------------------|-----------|-------------|
| id               | integer   | Primary key, auto-incrementing |
| user_id          | string    | Foreign key to users table |
| account_sid      | string    | Twilio Account SID |
| auth_token       | string    | Twilio Auth Token |
| from_phone_number| string    | Twilio phone number |
| created_at       | timestamp | Creation timestamp |

