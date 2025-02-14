# Make Twilio Call API

Initiates a call using Twilio and connects it to an Ultravox voice agent.

## Endpoint

```http
POST /api/twilio/call
```

### Request Body

```json
{
    "bot_id": "bot-uuid",
    "to_number": "+1234567890",
    "from_number": "+0987654321",
    "user_id": "user-uuid",
    "placeholders": {
        "left_delimeter": "<<<",
        "right_delimeter": ">>>",
        "key1": "value1",
        "key2": "value2"
    }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| bot_id | string | Yes | UUID of the bot to use for the call |
| to_number | string | Yes | Phone number to call |
| from_number | string | Yes | Twilio phone number to use as caller ID |
| user_id | string | Yes | UUID of the user making the call |
| placeholders | object | No | Optional object containing placeholder values to replace in the system prompt. The default delimiters are "<<<" and ">>>". Example: if system prompt contains "Hello <<<name>>>", and placeholders contains {"name": "John"}, the final prompt will be "Hello John" |

### Success Response (200 OK)

```json
{
    "status": "success",
    "data": {
        "from_number": "+0987654321",
        "to_number": "+1234567890",
        "bot_id": "bot-uuid",
        "status": "queued"
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

#### Bot Not Found (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Bot not found"
}
```

#### Twilio Account Not Found (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Twilio Account not found"
}
```

#### Ultravox API Error (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Failed to make call",
    "error": "Ultravox API error: [error details]"
}
```

#### Twilio API Error (500 Internal Server Error)
```json
{
    "status": "error",
    "message": "Failed to make call",
    "error": "Twilio API error: [error details]"
}
```
