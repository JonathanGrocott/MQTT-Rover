import { TopicTreeNode } from "../store/useAppStore";

export interface TopicRow {
  key: string;
  label: string;
  fullPath: string;
  depth: number;
  isLeaf: boolean;
  hasChildren: boolean;
  expanded: boolean;
}

function walk(
  node: TopicTreeNode,
  expandedPaths: Set<string>,
  rows: TopicRow[],
  depth: number
): void {
  const children = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const child of children) {
    const expanded = expandedPaths.has(child.fullPath);
    rows.push({
      key: child.fullPath,
      label: child.name,
      fullPath: child.fullPath,
      depth,
      isLeaf: child.isLeaf,
      hasChildren: child.children.size > 0,
      expanded
    });

    if (child.children.size > 0 && expanded) {
      walk(child, expandedPaths, rows, depth + 1);
    }
  }
}

export function flattenTopicTree(
  root: TopicTreeNode,
  expandedPaths: Set<string>
): TopicRow[] {
  const rows: TopicRow[] = [];
  walk(root, expandedPaths, rows, 0);
  return rows;
}

export function topicLeafRows(root: TopicTreeNode, filter: string): TopicRow[] {
  const normalized = filter.trim().toLowerCase();
  const rows: TopicRow[] = [];

  function collect(node: TopicTreeNode): void {
    for (const child of node.children.values()) {
      if (child.isLeaf && child.fullPath.toLowerCase().includes(normalized)) {
        rows.push({
          key: child.fullPath,
          label: child.fullPath,
          fullPath: child.fullPath,
          depth: 0,
          isLeaf: true,
          hasChildren: false,
          expanded: false
        });
      }
      if (child.children.size > 0) {
        collect(child);
      }
    }
  }

  collect(root);
  rows.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  return rows;
}
