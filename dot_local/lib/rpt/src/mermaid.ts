import type { TreeNode, ValidationIssue } from "./validation-types.ts";

const maximumMermaidDiagramBytes = 64 * 1024;
const maximumMermaidDiagrams = 20;

export type MermaidValidationState = {
  count: number;
  hasMermaid: boolean;
};

export function validateMermaidNode(
  node: TreeNode,
  state: MermaidValidationState,
): ValidationIssue | undefined {
  if (node.type !== "code" || node.lang !== "mermaid") {
    return undefined;
  }

  const source = node.value ?? "";
  if (Buffer.byteLength(source, "utf8") > maximumMermaidDiagramBytes) {
    return { message: "Mermaid diagram exceeds the 64 KiB limit", node };
  }
  if (/^---(?:\r?\n|$)/.test(source)) {
    return { message: "Mermaid frontmatter is not allowed", node };
  }
  if (/%%\s*\{\s*init(?:ialize)?\s*:/i.test(source)) {
    return { message: "Mermaid init directives are not allowed", node };
  }
  if (state.count >= maximumMermaidDiagrams) {
    return { message: "Mermaid diagrams exceed the 20 diagram limit", node };
  }

  state.count += 1;
  state.hasMermaid = true;
  return undefined;
}
