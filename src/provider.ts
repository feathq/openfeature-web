import { ErrorCode } from "@openfeature/core";
import type {
  EvaluationContext,
  JsonValue,
  Logger,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/core";
import type { Hook, Provider, ProviderStatus } from "@openfeature/web-sdk";
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
  status: ProviderStatus = "NOT_READY" as ProviderStatus;

  constructor(private readonly client: FeatWebClient) {}

  async initialize(context?: EvaluationContext): Promise<void> {
    // Only adopt OpenFeature's initial context if it has content. An
    // empty default from OpenFeature shouldn't clobber a context the
    // user already set on FeatWebClient directly.
    if (context && hasContent(context)) {
      await this.client.setContext(toEvalContext(context));
    }
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
    return {
      value: detail.value as T,
      reason: detail.reason,
      ...(detail.variationId ? { variant: detail.variationId } : {}),
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
  return {
    value: detail.value as T,
    reason: detail.reason,
    ...(detail.variationId ? { variant: detail.variationId } : {}),
    ...(detail.errorMessage ? { errorMessage: detail.errorMessage } : {}),
  };
}

function hasContent(of: EvaluationContext): boolean {
  if (typeof of.targetingKey === "string" && of.targetingKey.length > 0) return true;
  for (const k of Object.keys(of)) {
    if (k === "targetingKey") continue;
    return true;
  }
  return false;
}

// OpenFeature's EvaluationContext is { targetingKey?, [k: string]: JsonValue }.
// Our EvalContext is { targetingKey?, [kindKey]: ContextKindObject }. Same
// surface; we pass through, treating top-level keys other than
// targetingKey as context-kind buckets.
function toEvalContext(of: EvaluationContext): EvalContext {
  const { targetingKey, ...rest } = of;
  const out: EvalContext = {};
  if (typeof targetingKey === "string") out.targetingKey = targetingKey;
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
