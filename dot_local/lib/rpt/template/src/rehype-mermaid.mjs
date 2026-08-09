function markMermaidBlocks(node) {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (
    node.type === "element" &&
    node.tagName === "pre" &&
    node.children?.length === 1
  ) {
    const code = node.children[0];
    const classNames = code?.properties?.className;
    if (
      code?.type === "element" &&
      code.tagName === "code" &&
      Array.isArray(classNames) &&
      classNames.includes("language-mermaid")
    ) {
      node.properties ??= {};
      node.properties["data-rpt-mermaid"] = "";
    }
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(markMermaidBlocks);
  }
}

export default function rehypeMermaid() {
  return markMermaidBlocks;
}
