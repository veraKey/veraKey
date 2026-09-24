/**
 * How to reach the VeraKey team: an email address or a web address. While it is null, the docs name the team
 * without a link.
 */
export const CONTACT: string | null = null;

/** A link for `contact`: mailto: for an email address, the address itself otherwise. */
export function contactHref(contact: string): string {
  return /^[^@\s/]+@[^@\s/]+$/.test(contact) ? `mailto:${contact}` : contact;
}
