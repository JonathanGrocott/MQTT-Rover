export interface TopicRow {
  key: string;
  label: string;
  fullPath: string;
  depth: number;
  isLeaf: boolean;
  hasChildren: boolean;
  childCount: number;
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

export type TopicWorkerRequest =
  | AddTopicsRequest
  | ResetRequest
  | ComputeVisibleRequest;

export interface VisibleRowsResponse {
  type: "visible-rows";
  requestId: number;
  rows: TopicRow[];
  totalRows: number;
}

export type TopicWorkerResponse = VisibleRowsResponse;
