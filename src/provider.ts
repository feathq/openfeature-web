import { ErrorCode } from "@openfeature/core";
import type {
  EvaluationContext,
  JsonValue,
  Logger,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/core";
import type { Hook, Provider, ProviderStatus } from "@openfeature/web-sdk";
import { OpenFeatureEventEmitter, ProviderEvents } from "@openfeature/web-sdk";
import type { EvalContext, EvaluationResult, FeatWebClient } from "@feathq/web-sdk";

// Bridges feat's sync eval cache to the OpenFeature web Provider spec.
// Users write `client.getBooleanValue("flag-key", false)` against the
// OpenFeature client and this provider turns that into a sync cache
// lookup against FeatWebClient.allFlags().
//
// All resolve methods coerce by runtime type, so a flag declared as
// boolean that is somehow served a non-boolean value returns the
// default with reason ERROR rather than letting the wrong type through.
export class FeatWebProvider implements Provider {
  readonly metadata: ProviderMetadata = { name: "feat" };
  readonly runsOn = "client" as const;
  readonly hooks: Hook[] = [];
  // Lets OpenFeature (and the React hooks built on it) react to live flag
  // changes. We forward FeatWebClient's `change` events as
  // ProviderEvents.ConfigurationChanged below.
  readonly events = new OpenFeatureEventEmitter();
  status: ProviderStatus = "NOT_READY" as ProviderStatus;

  // Disposer returned by FeatWebClient.on("change", ...); called on close to
  // unsubscribe before the underlying client is torn down.
  private unsubscribeChange: (() => void) | undefined;

  constructor(private readonly client: FeatWebClient) {}

  async initialize(context?: EvaluationContext): Promise<void> {
    // Only adopt OpenFeature's initial context if it has content. An
    // empty default from OpenFeature shouldn't clobber a context the
    // user already set on FeatWebClient directly.
    if (context && hasContent(context)) {
      await this.client.setContext(toEvalContext(context));
    }
    // Forward each flag flip (poll or stream) to OpenFeature so the client
    // and React hooks re-render. Re-subscribing on a second initialize would
    // leak a listener, so drop any prior subscription first.
    this.unsubscribeChange?.();
    this.unsubscribeChange = this.client.on("change", (event) => {
      this.events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged: [event.flagKey] });
    });
    await this.client.ready();
    this.status = "READY" as ProviderStatus;
  }

  async onContextChange(
    _oldContext: EvaluationContext,
    newContext: EvaluationContext,
  ): Promise<void> {
    await this.client.setContext(toEvalContext(newContext));
  }

  async onClose(): Promise<void> {
    this.unsubscribeChange?.();
    this.unsubscribeChange = undefined;
    this.client.close();
    this.status = "NOT_READY" as ProviderStatus;
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<boolean> {
    return coerce<boolean>(this.client.getDetail(flagKey, defaultValue), defaultValue, "boolean");
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    _context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<string> {
    return coerce<string>(this.client.getDetail(flagKey, defaultValue), defaultValue, "string");
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    _context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<number> {
    return coerce<number>(this.client.getDetail(flagKey, defaultValue), defaultValue, "number");
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<T> {
    const detail = this.client.getDetail<unknown>(flagKey, defaultValue);
    if (typeof detail.value !== "object" || detail.value === null) {
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: ErrorCode.TYPE_MISMATCH,
        errorMessage: `flag "${flagKey}" is not an object`,
      };
    }
    const errorCode = errorCodeFor(detail);
    return {
      value: detail.value as T,
      reason: detail.reason,
      ...(detail.variationId ? { variant: detail.variationId } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(detail.errorMessage ? { errorMessage: detail.errorMessage } : {}),
    };
  }
}

function coerce<T extends boolean | string | number>(
  detail: EvaluationResult<unknown>,
  defaultValue: T,
  expected: "boolean" | "string" | "number",
): ResolutionDetails<T> {
  if (typeof detail.value !== expected) {
    return {
      value: defaultValue,
      reason: "ERROR",
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: `expected ${expected}, got ${typeof detail.value}`,
    };
  }
  const errorCode = errorCodeFor(detail);
  return {
    value: detail.value as T,
    reason: detail.reason,
    ...(detail.variationId ? { variant: detail.variationId } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(detail.errorMessage ? { errorMessage: detail.errorMessage } : {}),
  };
}

// A missing (or otherwise unevaluable) flag comes back from web-sdk with
// reason "ERROR" but the requested default value - which passes the runtime
// type check above, so it reaches this branch without an errorCode. Map the
// web-sdk errorMessage onto an OpenFeature ErrorCode. Successful reasons
// (FALLTHROUGH / TARGETING_MATCH / SPLIT / DISABLED / STATIC / DEFAULT) get
// none. Type mismatches are handled by callers before this runs.
function errorCodeFor(detail: EvaluationResult<unknown>): ErrorCode | undefined {
  if (detail.reason !== "ERROR") return undefined;
  const message = detail.errorMessage ?? "";
  if (message.includes("not ready")) return ErrorCode.PROVIDER_NOT_READY;
  if (message.includes("flag could not be evaluated")) return ErrorCode.FLAG_NOT_FOUND;
  return ErrorCode.GENERAL;
}

function hasContent(of: EvaluationContext): boolean {
  if (typeof of.targetingKey === "string" && of.targetingKey.length > 0) return true;
  for (const k of Object.keys(of)) {
    if (k === "targetingKey") continue;
    return true;
  }
  return false;
}

// OpenFeature's EvaluationContext is a flat bag: a `targetingKey` shorthand
// plus arbitrary attributes, some scalar, some nested. We fold it into feat's
// EvalContext:
//   - targetingKey (string) -> out.targetingKey.
//   - any non-array object value -> a context kind, passed through as-is
//     (multi-context), even when it has no `key`.
//   - every remaining top-level attribute (scalars, and arrays - anything that
//     isn't a context-kind object) -> merged into a default `user` kind, keyed
//     by targetingKey (or by an explicit user.key
//     if the caller also passed a `user` object). Explicit user attributes
//     win over folded scalars, and we never invent a key.
function toEvalContext(ctx: EvaluationContext): EvalContext {
  const out: EvalContext = {};
  const scalars: Record<string, unknown> = {};
  let targetingKey: string | undefined;
  for (const [k, v] of Object.entries(ctx)) {
    if (k === "targetingKey") {
      if (typeof v === "string") {
        targetingKey = v;
        out.targetingKey = v;
      }
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      (out as Record<string, unknown>)[k] = v;
      continue;
    }
    if (v === null || v === undefined) continue;
    scalars[k] = v;
  }
  if (Object.keys(scalars).length > 0) {
    const existingUser =
      out.user && typeof out.user === "object"
        ? (out.user as Record<string, unknown>)
        : undefined;
    const key = (existingUser?.key as string | undefined) ?? targetingKey;
    (out as Record<string, unknown>).user = {
      ...(key !== undefined ? { key } : {}),
      ...scalars,
      ...existingUser,
    };
  }
  return out;
}
