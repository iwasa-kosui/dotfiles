export function isAllowedNavigationUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("#") || trimmed.toLowerCase().startsWith("mailto:")) {
    return true;
  }
  if (trimmed.startsWith("//")) {
    return false;
  }
  const scheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.exec(trimmed)?.[0];
  return scheme === undefined || scheme.toLowerCase() === "https:";
}
