/**
 * Hosts VeraKey used to be served from. Accounts and passkeys are bound to one origin for good, so a former host
 * cannot keep serving the app: every request there goes to the same path on the deployment's origin. The status is
 * 308, so a POST stays a POST.
 */
export const FORMER_HOSTS = ["verakey.mdloglabs.org"];

/** Where a request for `path` on `host` belongs, or null when it belongs here. */
export function formerHostRedirect(host: string | undefined, path: string, origin: string): string | null {
  const name = (host ?? "").split(":")[0].toLowerCase();
  const current = new URL(origin);
  if (!FORMER_HOSTS.includes(name) || current.hostname === name) return null;
  // One leading slash, so "//evil.example" stays a path on this origin instead of naming another host.
  const target = new URL(`/${path.replace(/^[/\\]+/, "")}`, current);
  return target.origin === current.origin ? target.toString() : null;
}
