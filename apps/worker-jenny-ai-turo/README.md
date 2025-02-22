# API Documentation

This document provides an overview of the API endpoints available in the application. Each endpoint is described with its HTTP method, path, expected parameters, and examples.

### Base URL
[https://jenny-ai-turo.everyai-com.workers.dev](https://jenny-ai-turo.everyai-com.workers.dev/)

### Voice IDs
To get the voice IDs:
- **Method:** `GET`
- **Path:** `/api/voices`

## Twilio Endpoints

Steps to set up Twilio:
1. Create an account in Twilio using the account endpoints
2. Add any number of phone numbers under an account

### Account Endpoints

#### Create Twilio Account
- **Method:** `POST`
- **Path:** `/api/twilio/account`
- **Description:** Creates a new Twilio account record
- **Request Body:**
```json
{
  "account_sid": "AC123",
  "auth_token": "authToken",
  "account_name": "name_for_the_account",
  "user_id": "user123"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "", // This is needed to add numbers to your ID
    "account_name": "name_for_the_account",
    "account_sid": "AC123",
    "auth_token": "authToken",
    "user_id": "user123"
  }
}
```

#### Update Twilio Account
- **Method:** `PATCH`
- **Path:** `/api/twilio/account/:id`
- **Description:** Updates an existing Twilio account record
- **Request Body:**
```json
{
  "account_name": "hello_narasimha",
  "account_sid": "AC123",
  "auth_token": "newAuthToken",
  "user_id": "user123"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": 8,
    "account_name": "narasimha",
    "account_sid": "asfasfasfasfasfasf",
    "auth_token": "Asfjkasghfakljsfasf",
    "is_active": true,
    "created_at": "2025-02-15T17:37:36.77554+00:00",
    "updated_at": "2025-02-15T17:44:17.305598+00:00"
  }
}
```

#### Delete Twilio Account
- **Method:** `DELETE`
- **Path:** `/api/twilio/account/:id`
- **Description:** Deletes a Twilio account record
- **Request Body:**
```json
{
  "user_id": "asfasF-asf-4eef-asasfasfaf"
}
```
- **Response:**
```json
{
  "status": "success"
}
```

#### Get Twilio Account
- **Method:** `GET`
- **Path:** `/api/twilio/:id`
- **Description:** Retrieves a specific Twilio account record
- **Request Body:**
```json
{
  "user_id": "asasf-asfasf-235tfsdf-2453wfa"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "account_name": "Phadra",
    "account_sid": "aaasaaaaaaaaaaaaaa",
    "auth_token": "ssssssssssssssss",
    "is_active": true,
    "created_at": "2025-02-15T10:47:15.696593+00:00",
    "updated_at": "2025-02-15T10:47:15.696593+00:00",
    "twilio_phone_numbers": [
      {
        "id": 1,
        "is_active": true,
        "account_id": 1,
        "created_at": "2025-02-15T10:47:55.241543+00:00",
        "updated_at": "2025-02-15T10:47:55.241543+00:00",
        "phone_number": "+3456346346346",
        "friendly_name": "Phani"
      }
    ]
  }
}
```

#### Get All Twilio Accounts
- **Method:** `GET`
- **Path:** `/api/twilio/accounts`
- **Description:** Retrieves all Twilio account records for a specific user
- **Request Body:**
```json
{
  "user_id": "asfas-asfas-fasfasf-asf"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": [
    {
      "id": "2bd4cf5-5d9-917-84f3-cefd82ccc9",
      "account_name": "haha",
      "account_sid": "your_account_sid",
      "auth_token": "your_auth_token"
    },
    {
      "id": "3ce54df6-63ea-5028-95g4-d6efge93ddd0",
      "account_name": "haha",
      "account_sid": "another_account_sid",
      "auth_token": "another_auth_token"
    }
  ]
}
```

### Phone Numbers Endpoints

#### Create Twilio Phone Number
- **Method:** `POST`
- **Path:** `/api/twilio/phone-number`
- **Description:** Creates a new phone number under a Twilio account
- **Request Body:**
```json
{
  "account_id": "8",
  "friendly_name": "haha",
  "phone_number": "+9101124124",
  "user_id": "c99f3-a3-49-ad0-304712"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": 7,
    "account_id": 8,
    "phone_number": "+9101124124",
    "friendly_name": "haha",
    "is_active": true,
    "created_at": "2025-02-15T18:03:44.820599+00:00",
    "updated_at": "2025-02-15T18:03:44.820599+00:00"
  }
}
```

#### Update Twilio Phone Number
- **Method:** `PATCH`
- **Path:** `/api/twilio/phone-number/:id`
- **Description:** Updates an existing phone number
- **Request Body:**
```json
{
  "friendly_name": "hehehehaaaaaaaaaaaae",
  "phone_number": "+9101124124",
  "user_id": "c99c3-a1434bead8059cd04d712"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": 6,
    "account_id": 8,
    "phone_number": "+91024124",
    "friendly_name": "hehehehaaaaaaaaaaae",
    "is_active": true,
    "created_at": "2025-02-5T18:03:27.861626+00:00",
    "updated_at": "2025-02-15T18:13:14.617467+00:00"
  }
}
```

#### Delete Twilio Phone Number
- **Method:** `DELETE`
- **Path:** `/api/twilio/phone-number/:id`
- **Description:** Deletes a phone number
- **Request Body:**
```json
{
  "user_id": "asfasF-asf-4eef-asasfasfaf"
}
```
- **Response:**
```json
{
  "status": "success"
}
```

## Tools Endpoints

#### Create Tool
- **Method:** `POST`
- **Path:** `/api/tools`
- **Description:** Creates a new tool configuration
- **Query Parameters:**
  - `user_id`: The ID of the user creating the tool (required)
- **Request Body:**
```json
{
  "name": "string",
  "definition": {
    "modelToolName": "string",
    "description": "string",
    "dynamicParameters": [
      {
        "name": "string",
        "location": "PARAMETER_LOCATION_BODY",
        "schema": {
          "type": "object",
          "properties": {
            // Tool-specific properties schema
          },
          "required": ["field1", "field2"]
        },
        "required": true
      }
    ],
    "staticParameters": [
      {
        "name": "string",
        "location": "PARAMETER_LOCATION_QUERY",
        "value": "string"
      }
    ],
    "http": {
      "baseUrlPattern": "string",
      "httpMethod": "POST"
    },
    "timeout": "string",
    "precomputable": false
  }
}
```
- **Example Request:**
```json
{
  "name": "AppointmentBookingTool",
  "definition": {
    "modelToolName": "bookAppointment",
    "description": "Appointment Booking System Configuration",
    "dynamicParameters": [
      {
        "name": "appointmentDetails",
        "location": "PARAMETER_LOCATION_BODY",
        "schema": {
          "type": "object",
          "properties": {
            "appointmentType": {
              "type": "string",
              "enum": ["consultation", "follow_up", "general", "urgent"]
            },
            "preferredDate": {
              "type": "string",
              "format": "date"
            },
            "preferredTime": {
              "type": "string",
              "pattern": "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
            },
            "firstName": {
              "type": "string"
            },
            "lastName": {
              "type": "string"
            },
            "email": {
              "type": "string",
              "format": "email"
            },
            "notes": {
              "type": "string"
            }
          },
          "required": ["appointmentType", "preferredDate", "preferredTime", "firstName", "lastName", "email"]
        },
        "required": true
      }
    ],
    "staticParameters": [
      {
        "name": "access_token",
        "location": "PARAMETER_LOCATION_QUERY",
        "value": "default_access_token"
      },
      {
        "name": "refresh_token",
        "location": "PARAMETER_LOCATION_QUERY",
        "value": "default_refresh_token"
      }
    ],
    "http": {
      "baseUrlPattern": "https://a82a-183-83-224-223.ngrok-free.app/",
      "httpMethod": "POST"
    },
    "timeout": "20s",
    "precomputable": false
  }
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "tool123",
    "name": "AppointmentBookingTool",
    "definition": {
      // Same as request
    }
  }
}
```

#### Update Tool
- **Method:** `PATCH`
- **Path:** `/api/tools/:toolId`
- **Description:** Updates an existing tool configuration
- **URL Parameters:**
  - `toolId`: The ID of the tool to update (required)
- **Query Parameters:**
  - `user_id`: The ID of the user updating the tool (required)
- **Request Body:** Same structure as Create Tool
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "tool123",
    "name": "AppointmentBookingTool",
    "definition": {
      // Updated tool definition
    }
  }
}
```

#### Delete Tool
- **Method:** `DELETE`
- **Path:** `/api/tools/:toolId`
- **Description:** Deletes a tool configuration
- **URL Parameters:**
  - `toolId`: The ID of the tool to delete (required)
- **Query Parameters:**
  - `user_id`: The ID of the user deleting the tool (required)
- **Response:**
```json
{
  "status": "success"
}
```

#### Get Tool
- **Method:** `GET`
- **Path:** `/api/tools/:toolId`
- **Description:** Retrieves a specific tool configuration
- **URL Parameters:**
  - `toolId`: The ID of the tool to retrieve (required)
- **Query Parameters:**
  - `user_id`: The ID of the user retrieving the tool (required)
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "tool123",
    "name": "AppointmentBookingTool",
    "definition": {
      // Tool definition
    }
  }
}
```

#### Get All Tools
- **Method:** `GET`
- **Path:** `/api/tools`
- **Description:** Retrieves all tool configurations for a user
- **Query Parameters:**
  - `user_id`: The ID of the user retrieving the tools (required)
- **Response:**
```json
{
  "tools": {
    "results": [
      {
        "toolId": "tool123",
        "name": "AppointmentBookingTool",
        "created": "2025-02-17T12:00:00Z",
        "definition": {
          "modelToolName": "bookAppointment",
          "description": "Appointment Booking System Configuration",
          // ... rest of tool definition
        }
      }
    ],
    "total": 1
  }
}
```

## Agent Endpoints

#### Create Agent
- **Method:** `POST`
- **Path:** `/api/agent`
- **Description:** Creates a new agent
- **Request Body:**
```json
{
  "name": "Agent Name",
  "user_id": "user123",
  "voice_id": "voice123",
  "system_prompt": "Hello, how can I help you?"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "2bd4f5-57-84f3-d82ccc9",
    "created_at": "2025-02-12T13:52:19.887+00:00",
    "voice": "11b9ff430432e7c3",
    "system_prompt": "You are a helpf....es.",
    "user_id": "c99f0acd80-3f504d712",
    "name": "Customer Service Bot",
    "is_appointment_booking_allowed": false,
    "appointment_tool_id": null,
    "is_deleted": false
  }
}
```

#### Update Agent
- **Method:** `PATCH`
- **Path:** `/api/agent`
- **Description:** Updates an existing agent
- **Request Body:**
```json
{
  "id": "agent123",
  "name": "Updated Agent Name",
  "twilio_from_number": "+1234567890",
  "voice_id": "voice123",
  "system_prompt": "Updated prompt"
}
```
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "e84211c4f-597875853",
    "created_at": "2025-02-12T13:57:10.894+00:00",
    "voice": "11b9fe-80457d32e7c3",
    "system_prompt": "Updated the System prompt",
    "user_id": "c99f0ae9-59c04d712",
    "name": "Customer Service Bot",
    "is_appointment_booking_allowed": false,
    "appointment_tool_id": null,
    "is_deleted": false
  }
}
```

#### Delete Agent
- **Method:** `DELETE`
- **Path:** `/api/agent`
- **Description:** Marks an agent as deleted
- **Query Parameters:**
  - `id`: The ID of the agent

#### Get Agent
- **Method:** `GET`
- **Path:** `/api/agent/:id`
- **Description:** Retrieves a specific agent record
- **Response:**
```json
{
  "status": "success",
  "data": {
    "id": "ec15850-44b3-9362-92",
    "created_at": "2025-02-12T11.932+00:00",
    "voice": "11b9ff45-4333-0457d32e7c3",
    "system_prompt": "You are a helpful customer service agent. Your name is Sarah and you work for TechSupport Inc. Always be polite and professional in your responses.",
    "user_id": "c99f0-4be9-a59cd04d712",
    "name": "Customer Service Bot",
    "is_appointment_booking_allowed": false,
    "appointment_tool_id": null,
    "is_deleted": false
  }
}
```

#### Get All Agents
- **Method:** `GET`
- **Path:** `/api/agents`
- **Description:** Retrieves all agent records for a specific user
- **Query Parameters:**
  - `user_id`: The ID of the user
- **Response:**
```json
{
  "status": "success",
  "data": [
    {
      "id": "ec158362-9217c3cf92a2",
      "created_at": "2025-02-12T14:10:11.932+00:00",
      "voice": "11b9f333-a5ae2e7c3",
      "system_prompt": "You are a helpful customer service agent...",
      "user_id": "c99f0aad80-3f5712",
      "name": "Customer Service Bot",
      "is_appointment_booking_allowed": false,
      "appointment_tool_id": null,
      "is_deleted": false
    }
  ]
}
```

### Make a Twilio Call using Created Bot
- **Method:** `POST`
- **Path:** `/api/twilio/call`
- **Description:** Initiates a call using Twilio and connects it to Magic teams AI
- **Request Body:**
```json
{
  "bot_id": "bot123",
  "to_number": "+1234567890",
  "from_number": "+0987654321",
  "user_id": "user123",
  "placeholders": {
    "left_delimeter": "<<<",
    "right_delimeter": ">>>",
    "name": "....",
    "location": "...",
  }
}