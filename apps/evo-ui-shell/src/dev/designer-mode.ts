/** Browser designer workshop — canonical URI query flag. */
export const DESIGNER_QUERY_PARAM = "designer";

/** Legacy alias kept for early dev links. */
const LEGACY_DESIGNER_QUERY_PARAM = "display-test";

export function isDesignerMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return (
    params.get(DESIGNER_QUERY_PARAM) === "1" ||
    params.get(LEGACY_DESIGNER_QUERY_PARAM) === "1"
  );
}

/** Full designer URL on a deployed rig (open from laptop on LAN). The
 *  designer previews the live device, so there is no mock flag. */
export function designerUrlForHost(host: string): string {
  const base = host.includes("://") ? host : `http://${host}`;
  const url = new URL("/", base);
  url.searchParams.set(DESIGNER_QUERY_PARAM, "1");
  return url.toString();
}
