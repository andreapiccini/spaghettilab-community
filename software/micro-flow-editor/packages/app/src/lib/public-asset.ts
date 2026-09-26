/** Prefix a public-path asset so GitHub Pages / non-root `base` still resolve. */
export function publicAsset(path: string, baseUrl: string = import.meta.env.BASE_URL): string {
  const prefix = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const suffix = path.startsWith("/") ? path.slice(1) : path;
  return `${prefix}${suffix}`;
}
