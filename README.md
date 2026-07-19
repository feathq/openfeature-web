<p align="center">
  <a href="https://feat.so">
    <img src="https://feat.so/logo/wordmark.png" alt="feat.so" width="320" />
  </a>
</p>

---

# feat OpenFeature Provider

[OpenFeature](https://openfeature.dev) web Provider for [feat](https://feat.so) feature flags. Bridges the sync evaluation cache from `@feathq/web-sdk` to OpenFeature's client-side API.

## Install

```bash
npm install @feathq/web-sdk @feathq/openfeature-web @openfeature/web-sdk
```

`@feathq/web-sdk` and `@openfeature/web-sdk` are peer dependencies.

## Usage

```ts
import { OpenFeature } from "@openfeature/web-sdk";
import { FeatWebClient } from "@feathq/web-sdk";
import { FeatWebProvider } from "@feathq/openfeature-web";

const featClient = new FeatWebClient({
  apiKey: "feat_cs_…",
  url: "https://data-01.feat.so", // optional; this is the default
});

await OpenFeature.setProviderAndWait(new FeatWebProvider(featClient));
await OpenFeature.setContext({ targetingKey: "user-123" });

const client = OpenFeature.getClient();
const enabled = client.getBooleanValue("checkout-v2", false);   // sync
```

## Notes

- All `resolve*Evaluation` methods are synchronous: the underlying client caches the server-resolved flag values in a Map, refreshed on `setContext` and on each poll / stream update.
- Type coercion: a flag declared as `boolean` returns the default with `TYPE_MISMATCH` if asked for a string, etc.
- Live updates: when a flag value flips (poll or stream), the provider emits `ProviderEvents.ConfigurationChanged`, so the OpenFeature client and the `@openfeature/react-sdk` hooks re-render automatically.
- Error codes: a missing flag resolves with `errorCode: FLAG_NOT_FOUND` (and `PROVIDER_NOT_READY` before the client is ready); type mismatches keep `TYPE_MISMATCH`.
- `OpenFeature.setContext(...)` is the canonical way to change evaluation context; the provider's `onContextChange` propagates to the client.

## License

MIT
