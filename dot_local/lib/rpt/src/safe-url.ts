export function isAllowedNavigationUrl(value: string): boolean {
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) {
    return false;
  }
  try {
    const url = new URL(trimmed, "https://rpt.invalid/");
    return (
      url.protocol === "mailto:" ||
      (url.protocol === "https:" && url.origin !== "null")
    );
  } catch {
    return false;
  }
}
