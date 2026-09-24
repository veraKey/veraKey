import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RejectionNote } from "./components";

describe("RejectionNote", () => {
  it("tells a site's players what to do in the popup, not on app pages that do not manage a site's account", () => {
    const refusals = [
      { stage: "policy", revert: "NewPayeeCapExceeded" },
      { stage: "policy", revert: "AccountFrozen" },
      { stage: "policy", revert: "PaymentSheetRequired" },
      { stage: "policy", revert: "TokenTransferFailed" },
      { stage: "funds", revert: undefined },
    ] as const;
    for (const { stage, revert } of refusals) {
      const html = renderToStaticMarkup(<RejectionNote site state={{ status: "rejected", stage, message: "Refused.", revert }} />);
      expect(html).not.toMatch(/Policy page|Accounts page/);
    }
  });
});
