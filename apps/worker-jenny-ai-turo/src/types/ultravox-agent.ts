// Ultravox Agent API Type Definitions
// Based on Ultravox API documentation

export interface UltravoxAgentCallTemplate {
  name?: string;
  created?: string;
  updated?: string;
  medium?: {
    webRtc?: Record<string, unknown>;
    twilio?: Record<string, unknown>;
    serverWebSocket?: {
      inputSampleRate?: number;
      outputSampleRate?: number;
      clientBufferSizeMs?: number;
    };
  };
  systemPrompt: string;
  temperature: number;
  model: string;
  voice: string;
  recordingEnabled?: boolean;
  selectedTools?: Array<{
    toolName: string;
    descriptionOverride?: string;
    parameterOverrides?: Record<string, unknown>;
  } | {
    temporaryTool: {
      modelToolName: string;
      description: string;
      dynamicParameters?: Array<{
        name: string;
        location: string;
        schema: {
          type: string;
          description: string;
          enum?: string[];
        };
        required: boolean;
      }>;
      automaticParameters?: Array<{
        name: string;
        location: string;
        knownValue: string;
      }>;
      http: {
        baseUrlPattern: string;
        httpMethod: string;
      };
    };
  }>;
  firstSpeaker?: "FIRST_SPEAKER_AGENT" | "FIRST_SPEAKER_USER";
  statistics?: {
    calls: number;
  };
}

export interface UltravoxAgent {
  agentId: string;
  publishedRevisionId: string;
  name: string;
  created: string;
  callTemplate: UltravoxAgentCallTemplate;
}

export interface CreateUltravoxAgentRequest {
  name: string;
  callTemplate: Omit<UltravoxAgentCallTemplate, 'name' | 'created' | 'updated' | 'statistics'>;
}

export interface CreateUltravoxAgentResponse {
  agentId: string;
  publishedRevisionId: string;
  name: string;
  created: string;
  callTemplate: UltravoxAgentCallTemplate;
}

export interface UpdateUltravoxAgentRequest {
  name?: string;
  callTemplate?: Partial<Omit<UltravoxAgentCallTemplate, 'name' | 'created' | 'updated' | 'statistics'>>;
}

export interface UpdateUltravoxAgentResponse {
  agentId: string;
  publishedRevisionId: string;
  name: string;
  created: string;
  callTemplate: UltravoxAgentCallTemplate;
}

export interface CreateAgentCallRequest {
  templateContext?: Record<string, string>;
  metadata?: Record<string, string>;
  maxDuration?: string;
  recordingEnabled?: boolean;
  initialMessages?: Array<{
    role: string;
    text: string;
  }>;
  firstSpeakerSettings?: {
    agent?: {
      text: string;
    };
    user?: {
      text: string;
    };
  };
  medium?: {
    webRtc?: Record<string, unknown>;
    twilio?: Record<string, unknown>;
    serverWebSocket?: Record<string, unknown>;
  };
  joinTimeout?: string;
  initialOutputMedium?: "MESSAGE_MEDIUM_VOICE" | "MESSAGE_MEDIUM_TEXT";
}

export interface CreateAgentCallResponse {
  callId: string;
  clientVersion: string;
  created: string;
  joined: string | null;
  ended: string | null;
  endReason: string | null;
  billedDuration: string;
  firstSpeaker: string;
  model: string;
  recordingEnabled: boolean;
  systemPrompt: string;
  temperature: number;
  voice: string;
  transcriptOptional: boolean;
  errorCount: number;
  metadata: Record<string, string>;
  agentId: string;
  joinUrl?: string; // Added for Twilio stream
}

export interface ListAgentsResponse {
  next: string | null;
  previous: string | null;
  results: UltravoxAgent[];
  total: number;
}

// Bot to Agent mapping helper type
export interface BotToAgentMapping {
  name: string;
  systemPrompt: string;
  voice: string;
  model: string;
  temperature: number;
  selectedTools: UltravoxAgentCallTemplate['selectedTools'];
  firstSpeaker: "FIRST_SPEAKER_AGENT" | "FIRST_SPEAKER_USER";
  recordingEnabled: boolean;
  medium: UltravoxAgentCallTemplate['medium'];
}
