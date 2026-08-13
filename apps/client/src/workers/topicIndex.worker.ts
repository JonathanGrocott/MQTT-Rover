/// <reference lib="webworker" />

import {
  TopicRow,
  TopicWorkerRequest,
  TopicWorkerResponse
} from "../types/topicRows";
import {
  ActivitySignal,
  EMPTY_ACTIVITY_SIGNAL,
  recordActivitySignal,
  TopicActivityMode
} from "../lib/topicActivity";

interface TopicNode {
  name: string;
  fullPath: string;
  children: Map<string, TopicNode>;
  isLeaf: boolean;
  topicCount: number;
  messageCount: number;
  directActivity: ActivitySignal;
  descendantActivity: ActivitySignal;
}

function emptyActivity(): ActivitySignal {
  return { ...EMPTY_ACTIVITY_SIGNAL };
}

const root: TopicNode = {
  name: "",
  fullPath: "",
  children: new Map<string, TopicNode>(),
  isLeaf: false,
  topicCount: 0,
  messageCount: 0,
  directActivity: emptyActivity(),
  descendantActivity: emptyActivity()
};

const knownLeafTopics = new Set<string>();

function resetTree(): void {
  root.children.clear();
  root.topicCount = 0;
  root.messageCount = 0;
  root.directActivity = emptyActivity();
  root.descendantActivity = emptyActivity();
  knownLeafTopics.clear();
}

function insertTopic(topic: string): void {
  if (knownLeafTopics.has(topic)) {
    return;
  }
  knownLeafTopics.add(topic);

  const segments = topic.split("/");
  let cursor = root;
  const pathNodes: TopicNode[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index] ?? "";
    const fullPath = cursor.fullPath ? `${cursor.fullPath}/${name}` : name;

    let child = cursor.children.get(name);
    if (!child) {
      child = {
        name,
        fullPath,
        children: new Map<string, TopicNode>(),
        isLeaf: false,
        topicCount: 0,
        messageCount: 0,
        directActivity: emptyActivity(),
        descendantActivity: emptyActivity()
      };
      cursor.children.set(name, child);
    }

    if (index === segments.length - 1) {
      child.isLeaf = true;
    }

    cursor = child;
    pathNodes.push(child);
  }

  for (const node of pathNodes) {
    node.topicCount += 1;
  }
}

function incrementTopicMessageCount(
  topic: string,
  deltaMessages: number,
  now: number,
  activityMode: TopicActivityMode
): void {
  if (deltaMessages <= 0) {
    return;
  }

  const segments = topic.split("/");
  let cursor = root;
  cursor.messageCount += deltaMessages;

  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index] ?? "";
    const next = cursor.children.get(name);
    if (!next) {
      return;
    }
    next.messageCount += deltaMessages;
    if (index === segments.length - 1) {
      recordActivitySignal(
        next.directActivity,
        deltaMessages,
        now,
        activityMode
      );
    } else {
      recordActivitySignal(
        next.descendantActivity,
        deltaMessages,
        now,
        activityMode
      );
    }
    cursor = next;
  }
}

function walkVisible(
  node: TopicNode,
  expanded: Set<string>,
  rows: TopicRow[],
  depth: number
): void {
  const children = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const child of children) {
    const hasChildren = child.children.size > 0;
    const isExpanded = expanded.has(child.fullPath);

    rows.push({
      key: child.fullPath,
      label: child.name,
      fullPath: child.fullPath,
      depth,
      isLeaf: child.isLeaf,
      hasChildren,
      childCount: child.children.size,
      topicCount: child.topicCount,
      messageCount: child.messageCount,
      expanded: isExpanded,
      directActivityAt: child.directActivity.lastActivityAt,
      directPulseAt: child.directActivity.lastPulseAt,
      directBurstCount: child.directActivity.burstCount,
      descendantActivityAt: child.descendantActivity.lastActivityAt,
      descendantPulseAt: child.descendantActivity.lastPulseAt,
      descendantBurstCount: child.descendantActivity.burstCount
    });

    if (hasChildren && isExpanded) {
      walkVisible(child, expanded, rows, depth + 1);
    }
  }
}

function walkLeaves(node: TopicNode, filter: string, rows: TopicRow[]): void {
  for (const child of node.children.values()) {
    if (child.isLeaf && child.fullPath.toLowerCase().includes(filter)) {
      rows.push({
        key: child.fullPath,
        label: child.fullPath,
        fullPath: child.fullPath,
        depth: 0,
        isLeaf: true,
        hasChildren: false,
        childCount: 0,
        topicCount: 1,
        messageCount: child.messageCount,
        expanded: false,
        directActivityAt: child.directActivity.lastActivityAt,
        directPulseAt: child.directActivity.lastPulseAt,
        directBurstCount: child.directActivity.burstCount,
        descendantActivityAt: child.descendantActivity.lastActivityAt,
        descendantPulseAt: child.descendantActivity.lastPulseAt,
        descendantBurstCount: child.descendantActivity.burstCount
      });
    }

    if (child.children.size > 0) {
      walkLeaves(child, filter, rows);
    }
  }
}

function computeVisibleRows(expandedPaths: string[], searchTerm: string): TopicRow[] {
  const rows: TopicRow[] = [];
  const normalized = searchTerm.trim().toLowerCase();

  if (normalized.length > 0) {
    walkLeaves(root, normalized, rows);
    rows.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    return rows;
  }

  walkVisible(root, new Set(expandedPaths), rows, 0);
  return rows;
}

self.onmessage = (event: MessageEvent<TopicWorkerRequest>) => {
  const message = event.data;

  switch (message.type) {
    case "reset": {
      resetTree();
      break;
    }
    case "add-topics": {
      for (const topic of message.topics) {
        insertTopic(topic);
      }
      break;
    }
    case "update-topic-counts": {
      const now = Date.now();
      for (const update of message.updates) {
        incrementTopicMessageCount(
          update.topic,
          update.deltaMessages,
          now,
          message.activityMode
        );
      }
      break;
    }
    case "compute-visible": {
      const rows = computeVisibleRows(message.expandedPaths, message.searchTerm);
      const response: TopicWorkerResponse = {
        type: "visible-rows",
        requestId: message.requestId,
        rows,
        totalRows: rows.length
      };
      self.postMessage(response);
      break;
    }
  }
};
