/**
 * How to reach the VeraKey team: an email address or a web address. While it is null, the docs name the team
 * without a link.
 */
export const CONTACT: string | null = null;

/** The SDK's public page on npm, where `npm install @verakey/sdk` comes from. */
export const SDK_NPM_URL = "https://www.npmjs.com/package/@verakey/sdk";

/** A link for `contact`: mailto: for an email address, the address itself otherwise. */
export function contactHref(contact: string): string {
  return /^[^@\s/]+@[^@\s/]+$/.test(contact) ? `mailto:${contact}` : contact;
}
