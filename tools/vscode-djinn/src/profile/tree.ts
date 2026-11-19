import { FunctionEntry, LineStat, TreeNode } from "./types";

/** Splits `a::b<c::d>.e` on `::` and `.` outside of brackets. */
function splitName(name: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < name.length; i++) {
    const character = name[i];
    if (character === "<" || character === "(") {
      depth++;
    } else if (character === ">" || character === ")") {
      depth--;
    }
    if (depth === 0 && character === ":" && name[i + 1] === ":") {
      parts.push(current);
      current = "";
      i++;
    } else if (depth === 0 && character === ".") {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.length > 0);
}

function newNode(name: string): TreeNode {
  return { name, count: 0, children: new Map(), entry: undefined };
}

/** Groups functions by namespace into a tree, merging chains of single-child namespaces. */
export function buildTree(entries: FunctionEntry[]): TreeNode {
  const root = newNode("");
  for (const entry of entries) {
    let node = root;
    node.count += entry.count;
    for (const part of splitName(entry.name)) {
      let child = node.children.get(part);
      if (!child) {
        child = newNode(part);
        node.children.set(part, child);
      }
      child.count += entry.count;
      node = child;
    }
    node.entry = entry;
  }
  const compact = (node: TreeNode): void => {
    for (const [key, child] of [...node.children]) {
      let merged = child;
      while (merged.children.size === 1 && !merged.entry) {
        const only = merged.children.values().next().value as TreeNode;
        only.name = `${merged.name}::${only.name}`;
        merged = only;
      }
      node.children.delete(key);
      node.children.set(merged.name, merged);
      compact(merged);
    }
  };
  compact(root);
  return root;
}

export interface TopDetail {
  key: string;
  count: number;
  text: string;
}

/** The operations that took most of a line's samples. */
export function topDetails(stat: LineStat, limit: number): TopDetail[] {
  return [...stat.details.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, value]) => ({ key, count: value.count, text: value.text }));
}
