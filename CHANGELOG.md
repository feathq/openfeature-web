# Changelog

## 0.6.0

- Forward live flag changes to OpenFeature. The provider now exposes an
  `events` emitter and subscribes to `FeatWebClient`'s `change` events during
  `initialize`, re-emitting each as `ProviderEvents.ConfigurationChanged`
  (`{ flagsChanged: [flagKey] }`). This makes the OpenFeature client and the
  `@openfeature/react-sdk` hooks (`useFlag` / `useBooleanFlagValue`) re-render
  when a flag flips via poll or stream. The subscription is torn down in
  `onClose`.
- Map error codes for non-type-mismatch errors. A missing flag now resolves
  with `errorCode: FLAG_NOT_FOUND`, an evaluation attempted before the client
  is ready with `PROVIDER_NOT_READY`, and any other `ERROR`-reason result with
  `GENERAL`. Successful evaluations and the existing `TYPE_MISMATCH` path are
  unchanged.

## 0.5.0

- Initial release: OpenFeature web-sdk Provider wrapping `@feathq/web-sdk`'s
  sync evaluation cache.
