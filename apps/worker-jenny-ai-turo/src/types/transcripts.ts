export interface CallMessage {
    role: string;
    text: string;
    medium: string;
    callStageId: string;
    callStageMessageIndex: number;
  }
  
  export interface CallTranscriptResponse {
    next: string | null;
    previous: string | null;
    total: number;
    results: CallMessage[];
    warning?: string;
  }