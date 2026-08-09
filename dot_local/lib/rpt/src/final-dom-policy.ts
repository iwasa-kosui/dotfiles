export const mermaidCdnUrl =
  "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js" as const;

export const staticContentSecurityPolicy =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const mermaidInitScript = `(() => {
  const showError = (element) => {
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.textContent = "Mermaid diagram could not be rendered.";
    element.after(error);
  };
  const mermaid = window.mermaid;
  const elements = document.querySelectorAll("[data-rpt-mermaid]");
  if (mermaid === undefined) {
    elements.forEach(showError);
    return;
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  elements.forEach(async (element, index) => {
    const source = element.textContent ?? "";
    try {
      const { svg } = await mermaid.render("rpt-mermaid-" + index, source);
      element.innerHTML = svg;
    } catch {
      showError(element);
    }
  });
})();`;

export type FinalDomPolicy =
  | Readonly<{ kind: "static"; csp: string }>
  | Readonly<{
      kind: "mermaid";
      nonce: string;
      csp: string;
      cdnUrl: typeof mermaidCdnUrl;
      initScript: string;
    }>;

export function createFinalDomPolicy(hasMermaid: false): FinalDomPolicy;
export function createFinalDomPolicy(
  hasMermaid: true,
  nonce: string,
): FinalDomPolicy;
export function createFinalDomPolicy(
  hasMermaid: boolean,
  nonce?: string,
): FinalDomPolicy {
  if (!hasMermaid) {
    return { kind: "static", csp: staticContentSecurityPolicy };
  }
  if (nonce === undefined) {
    throw new Error("Mermaid final DOM policy requires a nonce");
  }
  return {
    kind: "mermaid",
    nonce,
    csp:
      staticContentSecurityPolicy +
      "; script-src 'nonce-" +
      nonce +
      "' https://cdn.jsdelivr.net",
    cdnUrl: mermaidCdnUrl,
    initScript: mermaidInitScript,
  };
}
