import { describe, expect, it } from "vitest";
import { tokenize, type Lang, type Token, type TokenType } from "./highlight";

const join = (tokens: Token[]) => tokens.map(t => t.text).join("");
const kinds = (tokens: Token[], type: TokenType) => tokens.filter(t => t.type === type).map(t => t.text);

describe("tokenize", () => {
  it("is lossless in every language", () => {
    const samples: [Lang, string][] = [
      ["ts", 'const vera = new VeraKeyClient({ relayerFee: 20_000n }); // fee\nawait vera.pay(APP_ID, to, 2_000_000n);'],
      ["bash", "pnpm install # deps\nscripts/deploy.sh sepolia --check"],
      ["rust", "pub fn pay(&mut self, to: Address) -> Result<(), AccountError> { /* body */ }"],
      ["solidity", "function verify(bytes calldata proof) external view returns (bool);"],
      ["json", '{ "chainId": 421614, "ok": true, "name": "sepolia" }'],
      ["text", "anything < goes > here"],
    ];
    for (const [lang, code] of samples) expect(join(tokenize(code, lang))).toBe(code);
  });
  it("classifies TypeScript tokens", () => {
    const t = tokenize('const x = "a"; await pay(1n); // done', "ts");
    expect(kinds(t, "keyword")).toEqual(["const", "await"]);
    expect(kinds(t, "string")).toEqual(['"a"']);
    expect(kinds(t, "function")).toEqual(["pay"]);
    expect(kinds(t, "number")).toEqual(["1n"]);
    expect(kinds(t, "comment")).toEqual(["// done"]);
  });
  it("treats # as a shell comment only at a line start or after whitespace", () => {
    expect(kinds(tokenize("echo a#b # note", "bash"), "comment")).toEqual(["# note"]);
  });
  it("marks capitalized names as types and hex literals as numbers", () => {
    const t = tokenize("let a: Address = 0x45bb;", "rust");
    expect(kinds(t, "type")).toEqual(["Address"]);
    expect(kinds(t, "number")).toEqual(["0x45bb"]);
  });
  it("highlights JSON literals", () => {
    const t = tokenize('{"a": 1, "b": null}', "json");
    expect(kinds(t, "string")).toEqual(['"a"', '"b"']);
    expect(kinds(t, "number")).toEqual(["1"]);
    expect(kinds(t, "keyword")).toEqual(["null"]);
  });
});
