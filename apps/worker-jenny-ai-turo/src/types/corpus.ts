export interface CorpusStats {
  status: 'CORPUS_STATUS_UNSPECIFIED' | 'CORPUS_STATUS_EMPTY' | 'CORPUS_STATUS_INITIALIZING' | 'CORPUS_STATUS_READY' | 'CORPUS_STATUS_UPDATING';
  lastUpdated: string;
  numChunks: number;
  numDocs: number;
  numVectors: number;
}

export interface Corpus {
  corpusId: string;
  created: string;
  name: string;
  description: string;
  userId: string;
  stats: CorpusStats;
}

export interface RelevantDocumentTypes {
  include?: {
    mimeTypes: string[];
  };
  exclude?: {
    mimeTypes: string[];
  };
}

export interface LoadSpec {
  maxDocuments?: number;
  maxDocumentBytes?: number;
  relevantDocumentTypes?: RelevantDocumentTypes;
  startUrls: string[];
  maxDepth: number;
}

export interface SourceStats {
  status: 'SOURCE_STATUS_UNSPECIFIED' | 'SOURCE_STATUS_INITIALIZING' | 'SOURCE_STATUS_READY' | 'SOURCE_STATUS_UPDATING';
  lastUpdated: string;
  numDocs: number;
}

export interface CorpusSource {
  corpusId: string;
  sourceId: string;
  created: string;
  name: string;
  description: string;
  userId: string;
  stats: SourceStats;
  loadSpec: LoadSpec;
}

export interface CreateCorpusRequest {
  name: string;
  description: string;
  userId: string;
  urls: string[];
}

export interface UpdateCorpusRequest {
  name?: string;
  description?: string;
  userId: string; // Required for authentication
  urls?: string[];
  maxDocuments?: number;
  maxDocumentBytes?: number;
  maxDepth?: number;
}

export interface KnowledgebaseData {
  corpus_id: string;
  source_id: string;
  user_id: string;
  name: string;
  description: string;
  source_urls: string[];
  created_at: string;
  updated_at: string;
}

export interface SourceUrlsResponse {
  name: string;
  description: string;
  urls: string[];
  status: 'processing' | 'ready' | 'error';
  lastUpdated: string;
  totalDocuments: number;
}
