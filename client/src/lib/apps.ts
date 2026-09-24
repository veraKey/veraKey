import { appIdFromName } from "@verakey/sdk/nullifier";

/**
 * The demo application. Every app id gets its own account and nullifier from the same passkey; the
 * demo shows one (Pay). Cross-app unlinkability is covered by the end-to-end tests.
 */
export interface DemoApp {
  key: "pay" | "shop";
  name: string;
  tagline: string;
  appId: bigint;
  tone: "lime" | "teal" | "violet";
}

export const DEMO_APPS: DemoApp[] = [
  { key: "pay", name: "Pay", tagline: "Everyday USDG checkout", appId: appIdFromName("pay"), tone: "lime" },
];

/**
 * A second app the same passkey could use. It is never deployed in the demo: the Accounts page derives
 * its address to show that nothing on-chain links it to Pay, and a disclosure can link the two by consent.
 */
export const SECOND_APP: DemoApp = {
  key: "shop",
  name: "Shop",
  tagline: "Another app, same passkey",
  appId: appIdFromName("shop"),
  tone: "teal",
};

export function appByKey(key: string | undefined): DemoApp {
  return DEMO_APPS.find(app => app.key === key) ?? DEMO_APPS[0];
}
