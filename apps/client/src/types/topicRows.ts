export interface TopicRow {
  key: string;
  label: string;
  fullPath: string;
  depth: number;
  isLeaf: boolean;
  hasChildren: boolean;
  childCount: number;
  topicCount: number;
  messageCount: number;
  expanded: boolean;
}

export interface AddTopicsRequest {
  type: "add-topics";
  topics: string[];
}

export interface ResetRequest {
  type: "reset";
}

export interface ComputeVisibleRequest {
  type: "compute-visible";
  requestId: number;
  expandedPaths: string[];
  searchTerm: string;
}

export interface UpdateTopicCountsRequest {
  type: "update-topic-counts";
  updates: Array<{
    topic: string;
    deltaMessages: number;
  }>;
}

export type TopicWorkerRequest =
  | AddTopicsRequest
  | ResetRequest
  | UpdateTopicCountsRequest
  | ComputeVisibleRequest;

export interface VisibleRowsResponse {
  type: "visible-rows";
  requestId: number;
  rows: TopicRow[];
  totalRows: number;
}

export type TopicWorkerResponse = VisibleRowsResponse;
