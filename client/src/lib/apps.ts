import { appIdFromName } from "@verakey/sdk/nullifier";

/** The three demo applications. Each gets its own account from the same passkey. */
export interface DemoApp {
  key: "pay" | "vault" | "tip";
  name: string;
  tagline: string;
  appId: bigint;
  tone: "lime" | "teal" | "violet";
}

export const DEMO_APPS: DemoApp[] = [
  { key: "pay", name: "Pay", tagline: "Everyday USDG checkout", appId: appIdFromName("pay"), tone: "lime" },
  { key: "vault", name: "Vault", tagline: "Savings you rarely touch", appId: appIdFromName("vault"), tone: "teal" },
  { key: "tip", name: "Tip", tagline: "Small payments to creators", appId: appIdFromName("tip"), tone: "violet" },
];

export function appByKey(key: string | undefined): DemoApp {
  return DEMO_APPS.find(app => app.key === key) ?? DEMO_APPS[0];
}
