/**
 * `uri` in WHATWG form when it is a `skill://` URI without a query, else `undefined`. A fragment
 * makes it `undefined` too, unless `dropFragment`: request URIs may carry one, served entries not.
 */
export function canonicalSkillUri(
  uri: unknown,
  { dropFragment = false }: { dropFragment?: boolean } = {}
): string | undefined {
  if (typeof uri !== "string") return undefined;
  try {
    const url = new URL(uri);
    if (url.protocol !== "skill:" || url.search) return undefined;
    if (url.hash) {
      if (!dropFragment) return undefined;
      url.hash = "";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/** `decodeURIComponent`, or the segment as it is when it is not valid percent-encoding. */
export function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
