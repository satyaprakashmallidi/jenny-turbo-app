import { KnownParamEnum, ParameterLocation } from "@repo/common-types/types";

export interface CreateToolRequest {
  name: string;
  definition: ToolDefinition;
}

export interface ToolResponse {
  toolId: string;
  name: string;
  created: string;
  definition: ToolDefinition;
}

export interface ListToolsResponse {
  next?: string;
  previous?: string;
  results: ToolResponse[];
  total: number;
}

// Type aliases for different responses
export type CreateToolResponse = ToolResponse;
export type GetToolResponse = ToolResponse;
export type UpdateToolResponse = ToolResponse;

export interface SelectedTool {
  toolId?: string;
  toolName?: string;
  temporaryTool?: ToolDefinition;
  nameOverride?: string;
  authTokens?: { [key: string]: string };
  parameterOverrides?: { [key: string]: any };
}

export interface ToolDefinition {
  modelToolName: string;
  description: string;
  dynamicParameters?: DynamicParameter[];
  staticParameters?: StaticParameter[];
  automaticParameters?: AutomaticParameter[];
  requirements?: ToolRequirements;
  timeout?: string;
  precomputable?: boolean;
  http?: HttpImplementation;
  client?: Record<string, any>;
}

export interface DynamicParameter {
  name: string;
  location: ParameterLocation;
  schema: Record<string, any>;
  required: boolean;
}

export interface StaticParameter {
  name: string;
  location: ParameterLocation;
  value: any;
}

export interface AutomaticParameter {
  name: string;
  location: ParameterLocation;
  knownValue: KnownParamEnum;
}

export interface HttpImplementation {
  baseUrlPattern: string;
  httpMethod: string;
}

export interface ToolRequirements {
  httpSecurityOptions: {
    options: HttpSecurityOption[];
  };
  requiredParameterOverrides: string[];
}

export interface HttpSecurityOption {
  requirements: Record<string, any>;
  ultravoxCallTokenRequirement?: {
    scopes: string[];
  };
}

export interface SecurityOptions {
  options: SecurityRequirements[];
}

export interface SecurityRequirements {
  requirements: { [key: string]: SecurityRequirement };
  ultravoxCallTokenRequirement?: UltravoxCallTokenRequirement;
}

export interface SecurityRequirement {
  queryApiKey?: QueryApiKeyRequirement;
  headerApiKey?: HeaderApiKeyRequirement;
  httpAuth?: HttpAuthRequirement;
}

export interface QueryApiKeyRequirement {
  name: string;
}

export interface HeaderApiKeyRequirement {
  name: string;
}

export interface HttpAuthRequirement {
  scheme: string;
}

export interface UltravoxCallTokenRequirement {
  scopes: string[];
}
