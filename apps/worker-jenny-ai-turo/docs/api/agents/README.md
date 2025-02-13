# AI Agents API Documentation

This section contains documentation for all AI agent-related endpoints.

## Available Endpoints

### Create Agent
- **[Create Agent](create-agent.md)** - `POST /api/agent/createAgent`
- Creates a new AI agent with specified voice and system prompt

### Update Agent
- **[Update Agent](update-agent.md)** - `POST /api/agent/updateAgent`
- Updates an existing AI agent's configuration

### Delete Agent
- **[Delete Agent](delete-agent.md)** - `DELETE /api/agent/deleteAgent`
- Soft deletes an AI agent by marking it as deleted

### Get Agent
- **[Get Agent](get-agent.md)** - `GET /api/agent/getAgent`
- Retrieves details of a specific AI agent

### Get All Agents
- **[Get All Agents](get-all-agents.md)** - `GET /api/agent/getAllAgents`
- Retrieves all non-deleted AI agents for a specific user

## Common Response Fields

All agent objects contain these fields:

| Field                      | Type      | Description |
|---------------------------|-----------|-------------|
| id                        | string    | UUID of the agent |
| created_at                | timestamp | Creation timestamp in ISO 8601 format |
| phone_number              | string    | Twilio phone number |
| voice                     | string    | Ultravox voice ID |
| system_prompt             | string    | The prompt that defines agent's behavior |
| user_id                   | string    | Owner of the agent |
| name                      | string    | Name of the agent |
| is_appointment_booking_allowed | boolean | Whether agent can book appointments |
| appointment_tool_id       | string    | ID of the appointment tool (if enabled) |
| is_deleted               | boolean   | Soft deletion status |
