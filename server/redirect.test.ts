import { describe, expect, it } from "vitest";
import { formerHostRedirect } from "./redirect";

const ORIGIN = "https://verakey.xyz";

describe("formerHostRedirect", () => {
  it("sends every request on the former host to the same path and query on the deployment's origin", () => {
    expect(formerHostRedirect("verakey.mdloglabs.org", "/docs/build/sign-in?x=1#y", ORIGIN)).toBe("https://verakey.xyz/docs/build/sign-in?x=1#y");
    expect(formerHostRedirect("verakey.mdloglabs.org", "/", ORIGIN)).toBe("https://verakey.xyz/");
    expect(formerHostRedirect("VeraKey.MDlogLabs.org", "/app", ORIGIN)).toBe("https://verakey.xyz/app");
  });
  it("never leaves the deployment's origin, whatever the path", () => {
    for (const path of ["//evil.example/x", "///evil.example", "/\\evil.example"]) {
      const target = formerHostRedirect("verakey.mdloglabs.org", path, ORIGIN);
      expect(new URL(target!).origin, path).toBe(ORIGIN);
    }
  });
  it("leaves the current host, local requests and unknown hosts alone", () => {
    for (const host of ["verakey.xyz", "127.0.0.1", "localhost", "example.com", undefined]) {
      expect(formerHostRedirect(host, "/docs", ORIGIN), String(host)).toBeNull();
    }
  });
  it("never redirects a deployment that is itself on the former host", () => {
    expect(formerHostRedirect("verakey.mdloglabs.org", "/docs", "https://verakey.mdloglabs.org")).toBeNull();
  });
});
