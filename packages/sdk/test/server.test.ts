import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import type { VeraKeyDeployment } from "../src/deployments";
import { createVeraKeyServer, memoryStore, toExpress, type VeraKeyServerOptions } from "../src/server";
import { ACCOUNT, GAME, HASH, NOW, VERAKEY, chain, deployment as signInDeployment, paidLog, signedIn, statement } from "./fixtures/signin";

const SECRET = "a secret of at least thirty-two bytes";
const MERCHANT: Address = "0x00000000000000000000000000000000000000cc";
const PLAYER = { id: statement.nullifier, account: ACCOUNT };
const deployment: VeraKeyDeployment = {
  ...signInDeployment,
  name: "test",
  rpcUrl: "http://127.0.0.1:1",
  usdg: "0x00000000000000000000000000000000000000ee",
};

beforeEach(() => {
  // Only the clock: the sign-in fixtures are made at NOW, and the kit's cookies expire by Date.now().
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const kit = (options: Partial<VeraKeyServerOptions> = {}) =>
  createVeraKeyServer({ origin: GAME, deployment, secret: SECRET, publicClient: chain(), store: memoryStore(), ...options });

/** A request from the site's page: its Origin, the browser's cookies, and a JSON body. */
function request(method: string, route: string, init: { body?: unknown; raw?: string; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? GAME;
  if (init.cookie) headers.cookie = init.cookie;
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${GAME}/api/verakey/${route}`, { method, headers, body });
}

/** The cookies responses set, as the Cookie header of the browser's next request (cleared ones left out). */
const cookiesOf = (...responses: Response[]) =>
  responses.flatMap(r => r.headers.getSetCookie()).map(c => c.split(";")[0]).filter(c => !c.endsWith("=")).join("; ");

/** One browser signing in: a nonce, then the popup's result posted with the nonce cookie. */
async function signIn(server = kit()) {
  const issued = await server.handle(request("POST", "nonce"));
  const { nonce } = (await issued.json()) as { nonce: Hex };
  const cookie = cookiesOf(issued);
  const response = await server.handle(request("POST", "sign-in", { body: await signedIn({ nonce }), cookie }));
  return { server, nonce, cookie, response, session: cookiesOf(response) };
}

describe("createVeraKeyServer: sign-in", () => {
  it("issues a nonce bound to this browser, in a signed cookie that lasts five minutes", async () => {
    const response = await kit().handle(request("POST", "nonce"));
    expect(response.status).toBe(200);
    const { nonce } = await response.json();
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(response.headers.getSetCookie()[0]).toMatch(
      new RegExp(`^__Host-verakey-nonce=${nonce}\\.${NOW + 300}\\.[A-Za-z0-9_-]{43}; Path=/; Max-Age=300; HttpOnly; SameSite=Strict; Secure$`)
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses requests from another origin, or without one, and says which address to open", async () => {
    const other = await kit().handle(request("POST", "nonce", { origin: "http://127.0.0.1:5173" }));
    expect(other.status).toBe(403);
    expect((await other.json()).error).toBe(`Open this site at ${GAME}: this request came from http://127.0.0.1:5173.`);
    expect((await kit().handle(request("POST", "nonce", { origin: null }))).status).toBe(403);
  });

  it("signs a player in, starts a session that getPlayer and the session route accept, and clears the nonce", async () => {
    const { server, response, session } = await signIn();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ player: PLAYER });
    const [sessionCookie, nonceCookie] = response.headers.getSetCookie();
    expect(sessionCookie).toMatch(/^__Host-verakey-session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure$/);
    expect(nonceCookie).toBe("__Host-verakey-nonce=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure");
    expect(await server.getPlayer(request("GET", "session", { cookie: session }))).toEqual(PLAYER);
    expect(await server.getPlayer({ headers: { cookie: session } })).toEqual(PLAYER);
    const known = await server.handle(request("GET", "session", { cookie: session }));
    expect(await known.json()).toEqual({ verakeyUrl: VERAKEY, merchant: null, player: PLAYER });
  });

  it("accepts a sign-in only in the browser that asked for its nonce, while the nonce lasts", async () => {
    const server = kit();
    const issued = await server.handle(request("POST", "nonce"));
    const result = await signedIn({ nonce: (await issued.json()).nonce });
    const post = (cookie: string) => server.handle(request("POST", "sign-in", { body: result, cookie }));
    expect((await post("")).status).toBe(403);
    const cookie = cookiesOf(issued);
    const tampered = cookie.replace(/\.[A-Za-z0-9_-]{43}$/, tag => `.${tag[1] === "A" ? "B" : "A"}${tag.slice(2)}`);
    expect((await post(tampered)).status).toBe(403);
    vi.setSystemTime((NOW + 301) * 1000);
    expect((await post(cookie)).status).toBe(403);
  });

  it("refuses a sign-in that answers an older request from the same browser (two tabs)", async () => {
    const server = kit();
    const first = await server.handle(request("POST", "nonce"));
    const firstNonce = (await first.json()).nonce;
    const second = await server.handle(request("POST", "nonce", { cookie: cookiesOf(first) }));
    const browser = cookiesOf(second); // the later nonce cookie replaced the first one
    const older = await server.handle(request("POST", "sign-in", { body: await signedIn({ nonce: firstNonce }), cookie: browser }));
    expect(older.status).toBe(403);
    expect((await older.json()).error).toMatch(/sign in again/);
    const newer = await server.handle(request("POST", "sign-in", { body: await signedIn({ nonce: (await second.json()).nonce }), cookie: browser }));
    expect(newer.status).toBe(200);
  });

  it("refuses a replayed sign-in", async () => {
    const server = kit();
    const issued = await server.handle(request("POST", "nonce"));
    const body = await signedIn({ nonce: (await issued.json()).nonce });
    const cookie = cookiesOf(issued);
    expect((await server.handle(request("POST", "sign-in", { body, cookie }))).status).toBe(200);
    expect((await server.handle(request("POST", "sign-in", { body, cookie }))).status).toBe(409);
  });

  it("refuses a sign-in that does not verify, with every check, and starts no session", async () => {
    const { response } = await signIn(kit({ publicClient: chain({ verify: false }) }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("The sign-in did not verify.");
    expect(body.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { name: string }) => c.name)).toEqual([
      "Proof verifies on-chain (HonkVerifier, eth_call)",
    ]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses malformed and oversized sign-ins", async () => {
    const server = kit();
    expect((await server.handle(request("POST", "sign-in", { body: {} }))).status).toBe(400);
    expect((await server.handle(request("POST", "sign-in", { raw: "not json" }))).status).toBe(400);
    expect((await server.handle(request("POST", "sign-in", { raw: JSON.stringify({ pad: "x".repeat(70_000) }) }))).status).toBe(413);
  });

  it("runs onSignIn before the session starts, and refuses the sign-in when it throws", async () => {
    const seen: unknown[] = [];
    const { response } = await signIn(kit({ onSignIn: player => void seen.push(player) }));
    expect(response.status).toBe(200);
    expect(seen).toEqual([PLAYER]);
    const refused = await signIn(kit({ onSignIn: () => { throw new Error("This player is banned."); } }));
    expect(refused.response.status).toBe(400);
    expect(await refused.response.json()).toEqual({ error: "This player is banned." });
    expect(refused.session).toBe("");
  });

  it("ignores a session cookie that was changed or has expired", async () => {
    const { server, session } = await signIn();
    const [name, value] = session.split("=");
    const tag = value.split(".")[1];
    const payload = Buffer.from(JSON.stringify({ v: 1, id: PLAYER.id, account: "0x00000000000000000000000000000000000000bb", exp: NOW + 999 })).toString("base64url");
    expect(await server.getPlayer({ headers: { cookie: `${name}=${payload}.${tag}` } })).toBeNull();
    vi.setSystemTime((NOW + 604_800) * 1000);
    expect(await server.getPlayer({ headers: { cookie: session } })).toBeNull();
    expect(await (await server.handle(request("GET", "session", { cookie: session }))).json()).toMatchObject({ player: null });
  });

  it("signs out by clearing the session cookie", async () => {
    const response = await kit().handle(request("POST", "sign-out"));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(["__Host-verakey-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
  });

  it("uses plain cookie names, without Secure, on http localhost", async () => {
    const response = await kit({ origin: "http://localhost:5192" }).handle(
      new Request("http://localhost:5192/api/verakey/nonce", { method: "POST", headers: { origin: "http://localhost:5192" } })
    );
    expect(response.headers.getSetCookie()[0]).toMatch(/^verakey-nonce=.*; SameSite=Strict$/);
  });

  it("answers unknown routes with 404 and wrong methods with 405, and ignores a trailing slash", async () => {
    const server = kit();
    expect((await server.handle(request("GET", "nope"))).status).toBe(404);
    expect((await server.handle(request("GET", "nonce"))).status).toBe(405);
    expect((await server.handle(new Request(`${GAME}/api/verakey/session/`))).status).toBe(200);
  });

  it("refuses to start with a weak secret, or a malformed origin, merchant, deployment or session length", () => {
    expect(() => kit({ secret: "short" })).toThrow(/at least 32 bytes/);
    for (const origin of ["https://game.example/", "https://game.example/play", "http://game.example", "game.example"]) {
      expect(() => kit({ origin }), origin).toThrow(/exact origin/);
    }
    expect(() => kit({ merchant: "0x1234" as Address })).toThrow(/merchant/);
    expect(() => kit({ deployment: { ...deployment, rpIdHash: "0x12" } })).toThrow(/deployment/);
    expect(() => kit({ sessionTtlSeconds: 0 })).toThrow(/sessionTtlSeconds/);
  });
});

/** A chain that verifies sign-ins and holds one 1 USDG payment to the merchant, found by nonce 7. */
function paymentChain(status: "success" | "pending" = "success"): PublicClient {
  const log = paidLog(ACCOUNT, MERCHANT, 1_000_000n, 20_000n);
  return {
    ...chain(),
    getTransactionReceipt: async () => {
      if (status === "pending") throw new Error("not found");
      return { status: "success", logs: [log] };
    },
    getTransaction: async () => ({ hash: HASH }),
    waitForTransactionReceipt: async () => ({ status: "success", logs: [log] }),
    getBlockNumber: async () => 100n,
    getContractEvents: async ({ args }: { args: { nonce: bigint } }) => (args.nonce === 7n ? [{ transactionHash: HASH }] : []),
  } as unknown as PublicClient;
}

describe("createVeraKeyServer: payments", () => {
  const shop = (options: Partial<VeraKeyServerOptions> = {}) => kit({ merchant: MERCHANT, publicClient: paymentChain(), ...options });
  const pay = (server: ReturnType<typeof kit>, session: string, body: unknown) => server.handle(request("POST", "payment", { body, cookie: session }));

  it("verifies a payment on-chain, hands it to onPayment, and accepts it once", async () => {
    const paid: unknown[] = [];
    const { server, session } = await signIn(shop({ onPayment: payment => (paid.push(payment), { swords: 1n }) }));
    const response = await pay(server, session, { amount: "1000000", hash: HASH });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hash: HASH, amount: "1000000", fee: "20000", result: { swords: "1" } });
    expect(paid).toEqual([{ player: PLAYER, hash: HASH, to: MERCHANT, amount: 1_000_000n, fee: 20_000n }]);
    expect((await pay(server, session, { amount: "1000000", hash: HASH })).status).toBe(409);
    expect(paid).toHaveLength(1);
  });

  it("finds a payment by the nonce of a payment the popup was sending", async () => {
    const { server, session } = await signIn(shop());
    const response = await pay(server, session, { amount: "1000000", nonce: "7" });
    expect(response.status).toBe(200);
    expect((await response.json()).hash).toBe(HASH);
  });

  it("waits for a payment that is sent but not yet in a block", async () => {
    const { server, session } = await signIn(shop({ publicClient: paymentChain("pending") }));
    expect((await pay(server, session, { amount: "1000000", hash: HASH })).status).toBe(200);
  });

  it("refuses a payment that does not verify, with its checks", async () => {
    const { server, session } = await signIn(shop());
    const response = await pay(server, session, { amount: "2000000", hash: HASH });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("The payment did not verify.");
    expect(body.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { name: string }) => c.name)).toEqual(["To this recipient, for this amount"]);
  });

  it("lets the player try again when onPayment throws", async () => {
    let attempts = 0;
    const onPayment = () => {
      if (++attempts === 1) throw new Error("The shop is closed for a minute.");
      return "ok";
    };
    const { server, session } = await signIn(shop({ onPayment }));
    const first = await pay(server, session, { amount: "1000000", hash: HASH });
    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({ error: "The shop is closed for a minute." });
    expect(await (await pay(server, session, { amount: "1000000", hash: HASH })).json()).toMatchObject({ result: "ok" });
  });

  it("needs a signed-in player and a merchant", async () => {
    expect((await pay(shop(), "", { amount: "1000000", hash: HASH })).status).toBe(401);
    const noShop = await signIn(kit());
    expect((await pay(noShop.server, noShop.session, { amount: "1000000", hash: HASH })).status).toBe(404);
  });

  it("refuses malformed payment requests", async () => {
    const { server, session } = await signIn(shop());
    for (const body of [{ amount: "0", hash: HASH }, { amount: 1000000, hash: HASH }, { amount: "1000000" }, { amount: "1000000", hash: "0x12" }]) {
      expect((await pay(server, session, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("warns once at startup when payments would be remembered in memory only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createVeraKeyServer({ origin: GAME, deployment, secret: SECRET, publicClient: chain(), merchant: MERCHANT });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/durable store/);
    kit({ merchant: MERCHANT });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("toExpress", () => {
  type Ended = { status: number; headers: Record<string, string | string[]>; body: string };

  /** An Express-like request and response, and what the response ended with (status -1: next got an error). */
  function exchange(init: { method: string; url: string; headers?: Record<string, string>; body?: unknown; stream?: string[] }) {
    let done!: (value: Ended) => void;
    const ended = new Promise<Ended>(resolve => (done = resolve));
    const headers: Record<string, string | string[]> = {};
    const req = {
      method: init.method,
      originalUrl: init.url,
      headers: { host: "game.example", origin: GAME, ...init.headers },
      body: init.body,
      async *[Symbol.asyncIterator]() {
        for (const chunk of init.stream ?? []) yield chunk;
      },
    };
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string | string[]) {
        headers[name] = value;
      },
      end(body?: string) {
        done({ status: this.statusCode, headers, body: body ?? "" });
      },
    };
    const next = (error?: unknown) => done({ status: -1, headers, body: String(error) });
    return { req, res, next, ended };
  }

  it("serves the kit's routes through Express's request and response", async () => {
    const { req, res, next, ended } = exchange({ method: "POST", url: "/api/verakey/nonce" });
    toExpress(kit())(req, res, next);
    const answer = await ended;
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body).nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(answer.headers["set-cookie"]).toEqual([expect.stringMatching(/^__Host-verakey-nonce=/)]);
    expect(answer.headers["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("reads a raw body, or one Express already parsed", async () => {
    const server = kit();
    const nonce = exchange({ method: "POST", url: "/api/verakey/nonce" });
    toExpress(server)(nonce.req, nonce.res, nonce.next);
    const issued = await nonce.ended;
    const cookie = (issued.headers["set-cookie"] as string[])[0].split(";")[0];
    const result = await signedIn({ nonce: JSON.parse(issued.body).nonce });
    const raw = exchange({ method: "POST", url: "/api/verakey/sign-in", headers: { cookie }, stream: [JSON.stringify(result)] });
    toExpress(server)(raw.req, raw.res, raw.next);
    expect((await raw.ended).status).toBe(200);
    const parsed = exchange({ method: "POST", url: "/api/verakey/sign-in", headers: { cookie }, body: {} });
    toExpress(server)(parsed.req, parsed.res, parsed.next);
    expect(JSON.parse((await parsed.ended).body)).toEqual({ error: "This is not a VeraKey sign-in." });
  });

  it("refuses a raw body larger than the kit accepts", async () => {
    const { req, res, next, ended } = exchange({ method: "POST", url: "/api/verakey/sign-in", stream: ["x".repeat(40_000), "x".repeat(40_000)] });
    toExpress(kit())(req, res, next);
    expect((await ended).status).toBe(413);
  });
});
