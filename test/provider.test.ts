import { describe, expect, it } from "vitest";
import { OpenFeature, ProviderEvents } from "@openfeature/web-sdk";
import { ErrorCode } from "@openfeature/core";
import { FeatWebClient } from "@feathq/web-sdk";
import { FeatWebProvider } from "../src/provider";

// The remote-eval response shape returned by POST /sdk/v1/evaluate: resolved
// values only (no datafile). web-sdk 0.5.0 adopts this map directly, so the
// provider reads these values synchronously.
const EVALUATION = {
  flags: {
    "checkout-enabled": { value: true, variationId: "v-on", reason: "FALLTHROUGH" },
    greeting: { value: "hello", variationId: "v-hello", reason: "FALLTHROUGH" },
  },
  version: 1,
};

function passingFetch(): typeof fetch {
  return (async () => ({
    status: 200,
    ok: true,
    statusText: "ok",
    headers: { get: () => null },
    json: async () => EVALUATION,
  })) as unknown as typeof fetch;
}

// A fetch mock whose response is read from `state.current` at call time, so a
// test can swap in a newer snapshot and force a re-poll to drive a flag change.
type Snapshot = { flags: Record<string, unknown>; version: number };
function mutableFetch(state: { current: Snapshot }): typeof fetch {
  return (async () => ({
    status: 200,
    ok: true,
    statusText: "ok",
    headers: { get: () => null },
    json: async () => state.current,
  })) as unknown as typeof fetch;
}

describe("FeatWebProvider", () => {
  it("sync getBooleanValue returns the flag value through OpenFeature", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "u1" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    const client = OpenFeature.getClient();
    expect(client.getBooleanValue("checkout-enabled", false)).toBe(true);
    expect(client.getStringValue("greeting", "fallback")).toBe("hello");

    featClient.close();
    await OpenFeature.close();
  });

  it("forwards a flag change as ProviderEvents.ConfigurationChanged through OpenFeature", async () => {
    const state: { current: Snapshot } = { current: EVALUATION };
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "u1" },
      fetch: mutableFetch(state),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    const client = OpenFeature.getClient();
    const changed = new Promise<string[] | undefined>((resolve) => {
      client.addHandler(ProviderEvents.ConfigurationChanged, (details) => {
        resolve(details?.flagsChanged);
      });
    });

    // Flip checkout-enabled and bump the datafile version, then force a poll:
    // the underlying client fires `change`, which the provider forwards.
    state.current = {
      flags: {
        "checkout-enabled": { value: false, variationId: "v-off", reason: "FALLTHROUGH" },
        greeting: { value: "hello", variationId: "v-hello", reason: "FALLTHROUGH" },
      },
      version: 2,
    };
    await featClient.refresh();

    expect(await changed).toEqual(["checkout-enabled"]);
    expect(client.getBooleanValue("checkout-enabled", true)).toBe(false);

    featClient.close();
    await OpenFeature.close();
  });

  it("a missing flag resolves with FLAG_NOT_FOUND", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "u1" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    const client = OpenFeature.getClient();
    const detail = client.getBooleanDetails("does-not-exist", false);
    expect(detail.value).toBe(false);
    expect(detail.reason).toBe("ERROR");
    expect(detail.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);

    featClient.close();
    await OpenFeature.close();
  });

  it("type mismatch returns the default with ERROR reason", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "u1" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    const client = OpenFeature.getClient();
    // checkout-enabled is a boolean flag; asking for a string returns the default.
    const detail = client.getStringDetails("checkout-enabled", "fallback");
    expect(detail.value).toBe("fallback");
    expect(detail.reason).toBe("ERROR");
    expect(detail.errorCode).toBe("TYPE_MISMATCH");

    featClient.close();
    await OpenFeature.close();
  });

  it("OpenFeature.setContext propagates through onContextChange", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "before-change" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);
    expect(featClient.currentContext()?.targetingKey).toBe("before-change");

    await OpenFeature.setContext({ targetingKey: "after-change" });
    expect(featClient.currentContext()?.targetingKey).toBe("after-change");

    featClient.close();
    await OpenFeature.close();
  });

  it("folds flat scalar attributes into a default user kind", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "seed" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    await OpenFeature.setContext({ targetingKey: "u1", plan: "pro" });

    const ctx = featClient.currentContext();
    expect(ctx?.targetingKey).toBe("u1");
    expect(ctx?.user).toEqual({ key: "u1", plan: "pro" });

    featClient.close();
    await OpenFeature.close();
  });

  it("merges flat scalars into an explicit user object, explicit key wins", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "seed" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    await OpenFeature.setContext({
      targetingKey: "u1",
      plan: "pro",
      user: { key: "explicit", tier: "gold" },
    });

    const ctx = featClient.currentContext();
    expect(ctx?.user).toEqual({ key: "explicit", plan: "pro", tier: "gold" });

    featClient.close();
    await OpenFeature.close();
  });

  it("passes a nested organization kind through untouched", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      url: "https://dp.example.com",
      context: { targetingKey: "seed" },
      fetch: passingFetch(),
    });
    const provider = new FeatWebProvider(featClient);
    await OpenFeature.setProviderAndWait(provider);

    await OpenFeature.setContext({
      targetingKey: "u1",
      organization: { key: "org-9", plan: "enterprise" },
    });

    const ctx = featClient.currentContext();
    expect(ctx?.organization).toEqual({ key: "org-9", plan: "enterprise" });
    // No scalars present, so no default user kind is synthesized.
    expect(ctx?.user).toBeUndefined();

    featClient.close();
    await OpenFeature.close();
  });
});
