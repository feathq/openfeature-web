import { describe, expect, it } from "vitest";
import { OpenFeature } from "@openfeature/web-sdk";
import { FeatWebClient } from "@feathq/feat-web-sdk";
import type { Datafile } from "@feathq/feat-web-sdk";
import { FeatWebProvider } from "../src/provider";

const DATAFILE: Datafile = {
  schemaVersion: 1,
  envId: "env-1",
  envKey: "p",
  projectId: "p",
  version: 1,
  etag: "x",
  generatedAt: new Date().toISOString(),
  flags: {
    "checkout-enabled": {
      id: "f1",
      key: "checkout-enabled",
      valueType: "boolean",
      salt: "0000000000000000",
      archived: false,
      isEnabled: true,
      offVariationId: "v-off",
      defaultVariationId: "v-on",
      defaultRollout: null,
      defaultBucketingContextKindKey: null,
      variations: [
        { id: "v-on", name: "on", value: true },
        { id: "v-off", name: "off", value: false },
      ],
      targets: [],
      rules: [],
    },
    greeting: {
      id: "f2",
      key: "greeting",
      valueType: "string",
      salt: "0000000000000000",
      archived: false,
      isEnabled: true,
      offVariationId: "v-empty",
      defaultVariationId: "v-hello",
      defaultRollout: null,
      defaultBucketingContextKindKey: null,
      variations: [
        { id: "v-hello", name: "hello", value: "hello" },
        { id: "v-empty", name: "empty", value: "" },
      ],
      targets: [],
      rules: [],
    },
  },
  segments: {},
  contextKinds: {
    user: { key: "user", availableForRules: true, availableForExperiments: true },
  },
};

function passingFetch(): typeof fetch {
  return (async () => ({
    status: 200,
    ok: true,
    statusText: "ok",
    headers: { get: () => null },
    json: async () => DATAFILE,
  })) as unknown as typeof fetch;
}

describe("FeatWebProvider", () => {
  it("sync getBooleanValue returns the flag value through OpenFeature", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      dataPlaneUrl: "https://dp.example.com",
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

  it("type mismatch returns the default with ERROR reason", async () => {
    const featClient = new FeatWebClient({
      apiKey: "feat_cs_x",
      dataPlaneUrl: "https://dp.example.com",
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
      dataPlaneUrl: "https://dp.example.com",
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
});
