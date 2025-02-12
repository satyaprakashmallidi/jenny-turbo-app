# API Documentation

This document provides an overview of the API endpoints available in the application. Each endpoint is described with its HTTP method, path, expected parameters, and a brief example if applicable.

## Table of Contents

- [Ultravox Endpoints](#ultravox-endpoints)
  - [Create Call](#create-call)
  - [Get Voices](#get-voices)
- [Summary Endpoints](#summary-endpoints)
  - [Send Summary](#send-summary)
  - [Get Summary](#get-summary)
- [User Calls Endpoints](#user-calls-endpoints)
  - [Add Call to DB](#add-call-to-db)
  - [Get All Calls of User](#get-all-calls-of-user)
- [Twilio Endpoints](#twilio-endpoints)
  - [Create Twilio Account](#create-twilio-account)
  - [Update Twilio Account](#update-twilio-account)
  - [Delete Twilio Account](#delete-twilio-account)
  - [Get Twilio Account](#get-twilio-account)
  - [Get All Twilio Accounts](#get-all-twilio-accounts)
  - [Make a Call](#make-a-call)
  - [Twilio Webhook](#twilio-webhook)
- [Agent Endpoints](#agent-endpoints)
  - [Create Agent](#create-agent)
  - [Update Agent](#update-agent)
  - [Delete Agent](#delete-agent)
  - [Get Agent](#get-agent)
  - [Get All Agents](#get-all-agents)

## Ultravox Endpoints

### Create Call

- **Method:** `POST`
- **Path:** `/api/ultravox/createcall`
- **Description:** Creates a call using the Ultravox API.
- **Example Request:**
  ```json
  {
    "someKey": "someValue"
  }
  ```

### Get Voices

- **Method:** `GET`
- **Path:** `/api/ultravox/voices`
- **Description:** Retrieves a list of available voices from the Ultravox API.

## Summary Endpoints

### Send Summary

- **Method:** `POST`
- **Path:** `/api/sendSummary`
- **Description:** Sends a conversation summary to the database.
- **Example Request:**
  ```json
  {
    "conversationSummary": "This is a summary."
  }
  ```

### Get Summary

- **Method:** `GET`
- **Path:** `/api/getSummary`
- **Description:** Retrieves a summary for a specific call.
- **Query Parameters:**
  - `call_id`: The ID of the call.

## User Calls Endpoints

### Add Call to DB

- **Method:** `POST`
- **Path:** `/api/add-call-to-db`
- **Description:** Adds a call record to the database.
- **Example Request:**
  ```json
  {
    "user_id": "123",
    "call_id": "abc",
    "bot_id": "bot123"
  }
  ```

### Get All Calls of User

- **Method:** `GET`
- **Path:** `/api/get-all-calls-of-user`
- **Description:** Retrieves all call records for a specific user.
- **Query Parameters:**
  - `user_id`: The ID of the user.

## Twilio Endpoints

### Create Twilio Account

- **Method:** `POST`
- **Path:** `/api/twilio`
- **Description:** Creates a new Twilio account record.
- **Example Request:**
  ```json
  {
    "accountSID": "AC123",
    "authToken": "authToken",
    "fromNumber": "+1234567890",
    "user_id": "user123"
  }
  ```

### Update Twilio Account

- **Method:** `PATCH`
- **Path:** `/api/twilio/:id`
- **Description:** Updates an existing Twilio account record.
- **Example Request:**
  ```json
  {
    "accountSID": "AC123",
    "authToken": "newAuthToken",
    "fromNumber": "+0987654321",
    "user_id": "user123"
  }
  ```

### Delete Twilio Account

- **Method:** `DELETE`
- **Path:** `/api/twilio/deleteAccount`
- **Description:** Deletes a Twilio account record.
- **Query Parameters:**
  - `id`: The ID of the Twilio account.

### Get Twilio Account

- **Method:** `GET`
- **Path:** `/api/twilio/:id`
- **Description:** Retrieves a specific Twilio account record.

### Get All Twilio Accounts

- **Method:** `GET`
- **Path:** `/api/twilios`
- **Description:** Retrieves all Twilio account records for a specific user.
- **Query Parameters:**
  - `user_id`: The ID of the user.

### Make a Call

- **Method:** `POST`
- **Path:** `/api/twilio/call`
- **Description:** Initiates a call using Twilio and connects it to Ultravox.
- **Example Request:**
  ```json
  {
    "bot_id": "bot123",
    "to_number": "+1234567890",
    "from_number": "+0987654321",
    "user_id": "user123"
  }
  ```

### Twilio Webhook

- **Method:** `POST`
- **Path:** `/api/twilio/webhook`
- **Description:** Handles Twilio status callbacks.

## Agent Endpoints

### Create Agent

- **Method:** `POST`
- **Path:** `/api/agent`
- **Description:** Creates a new agent.
- **Example Request:**
  ```json
  {
    "name": "Agent Name",
    "user_id": "user123",
    "voice_id": "voice123",
    "system_prompt": "Hello, how can I help you?"
  }
  ```

### Update Agent

- **Method:** `PATCH`
- **Path:** `/api/agent`
- **Description:** Updates an existing agent.
- **Example Request:**
  ```json
  {
    "id": "agent123",
    "name": "Updated Agent Name",
    "twilio_from_number": "+1234567890",
    "voice_id": "voice123",
    "system_prompt": "Updated prompt"
  }
  ```

### Delete Agent

- **Method:** `DELETE`
- **Path:** `/api/agent`
- **Description:** Marks an agent as deleted.
- **Query Parameters:**
  - `id`: The ID of the agent.

### Get Agent

- **Method:** `GET`
- **Path:** `/api/agent/:id`
- **Description:** Retrieves a specific agent record.

### Get All Agents

- **Method:** `GET`
- **Path:** `/api/agents`
- **Description:** Retrieves all agent records for a specific user.
- **Query Parameters:**
  - `user_id`: The ID of the user.

## Root Endpoint

### Hello Hono

- **Method:** `GET`
- **Path:** `/`
- **Description:** A simple endpoint to test the server.
- **Response:** Returns a greeting message.

---

This documentation provides a comprehensive overview of the API endpoints available in the application. For further details or questions, please refer to the source code or contact the development team.