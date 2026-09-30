/**
 * How to reach the VeraKey team: an email address or a web address. While it is null, the docs name the team
 * without a link.
 */
export const CONTACT: string | null = "https://x.com/veraKey_";

/** The SDK's public page on npm, where `npm install @verakey/sdk` comes from. */
export const SDK_NPM_URL = "https://www.npmjs.com/package/@verakey/sdk";

/**
 * The <title> and meta description of client/index.html, which the landing page and the app keep. The docs put
 * them back when a reader leaves the docs. site.test.ts checks that they still match index.html.
 */
export const SITE_TITLE = "VeraKey — one passkey, unlinkable on-chain identities on Arbitrum";
export const SITE_DESCRIPTION =
  "Every app gets its own USDG account and ID behind one passkey, with payments, sign-in and recovery built in. " +
  "Each approval is a zero-knowledge proof made in your browser, so nothing on-chain links them.";

/** A link for `contact`: mailto: for an email address, the address itself otherwise. */
export function contactHref(contact: string): string {
  return /^[^@\s/]+@[^@\s/]+$/.test(contact) ? `mailto:${contact}` : contact;
}
