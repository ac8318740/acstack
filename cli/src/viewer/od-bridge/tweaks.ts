// Vendored excerpt from OpenDesigner (github.com/ac8318740/open-designer) at commit
// 9769b8e17d3657e8c27aab4db73681d8a7dbcbc9: the tweak types from viewer/src/types.ts
// and the pure value functions from viewer/src/tweaks.ts (defaultFor through tweakPayload),
// so ACStack computes `tweaks` payloads exactly as OpenDesigner does. Do not edit; re-vendor to update.

import type { TweakPayload } from "./protocol.js";

export type TokensMap = Map<string, string>;
export interface TweakSelectOption {
  label: string;
  value: string;
}

export type TweakType = "select" | "color" | "slider" | "toggle" | "text" | "state";

// How the slider/picker value maps to each target CSS variable.
// - "set" (default): every target gets the raw value.
// - "add": slider only. Each target = parseNumeric(tokensMap[target]) + value + unit.
// - "scale": slider only. Each target = parseNumeric(tokensMap[target]) * value + unit.
export type TweakTransform = "set" | "add" | "scale";

interface TweakBase {
  id: string;
  label: string;
  // target + targets are mutually exclusive. Single-target `target` stays
  // supported for back-compat; multi-target previews use `targets`.
  target?: string;
  targets?: string[];
  transform?: TweakTransform;
  default?: string | number | boolean;
}

export interface SliderTweak extends TweakBase {
  type: "slider";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface ColorTweak extends TweakBase {
  type: "color";
}

export interface TextTweak extends TweakBase {
  type: "text";
}

export interface SelectTweak extends TweakBase {
  type: "select";
  options?: Array<string | TweakSelectOption>;
  // Why the un-picked alternatives drop from production at finalize time.
  // Required by the finalize-discard test; missing values surface as a
  // schema warning and are treated as empty until the author fills them.
  discardReason: string;
}

export interface ToggleTweak extends TweakBase {
  type: "toggle";
  on?: string;
  off?: string;
  discardReason: string;
}

export interface StateTweak extends TweakBase {
  type: "state";
  options?: Array<string | TweakSelectOption>;
  // No discardReason – state values are runtime conditions, not designer
  // decisions, so the finalize-discard test does not apply.
}

export type Tweak =
  | SliderTweak
  | ColorTweak
  | TextTweak
  | SelectTweak
  | ToggleTweak
  | StateTweak;

type WithOptions = { options?: Array<string | { label: string; value: string }> };

function resolveSelectValue(tweak: WithOptions, raw: string): string {
  const options = tweak.options;
  if (!options) return raw;
  for (const opt of options) {
    if (typeof opt === "string") {
      if (opt === raw) return opt;
    } else if (opt.value === raw || opt.label === raw) {
      return opt.value;
    }
  }
  return raw;
}

export function defaultFor(tweak: Tweak): string {
  if (tweak.default !== undefined) return String(tweak.default);
  switch (tweak.type) {
    case "toggle":
      return tweak.off ?? "0";
    case "slider":
      return String(tweak.min ?? 0);
    case "color":
      return "#000000";
    case "select":
    case "state": {
      const first = tweak.options?.[0];
      if (first === undefined) return "";
      return typeof first === "string" ? first : first.value;
    }
    default:
      return "";
  }
}

export function buildInitialValues(
  tweaks: Tweak[],
  stored: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tweaks) {
    out[t.id] = stored[t.id] ?? defaultFor(t);
  }
  return out;
}

export function cssValueFor(tweak: Tweak, raw: string): string {
  switch (tweak.type) {
    case "slider": {
      const unit = tweak.unit ?? "";
      return `${raw}${unit}`;
    }
    case "select":
    case "state":
      return resolveSelectValue(tweak, raw);
    case "toggle":
      return raw === "1" ? (tweak.on ?? "1") : (tweak.off ?? "0");
    default:
      return raw;
  }
}

// Returns the list of CSS variables this tweak writes to. `target` + `targets`
// are mutually exclusive; a tweak with neither is a declaration bug but we
// tolerate it (empty list means no variables are emitted).
export function resolvedTargets(tweak: Tweak): string[] {
  if (Array.isArray(tweak.targets) && tweak.targets.length > 0) return tweak.targets;
  if (tweak.target) return [tweak.target];
  return [];
}

export function resolvedTransform(tweak: Tweak): TweakTransform {
  const t = tweak.transform;
  if (t === "add" || t === "scale") {
    if (tweak.type !== "slider") {
      // Non-slider types can't sensibly use add/scale. Warn once and treat as set.
      console.warn(
        `[od] tweak "${tweak.id}" uses transform "${t}" but type "${tweak.type}" is not slider – treating as "set".`,
      );
      return "set";
    }
    return t;
  }
  return "set";
}

// Extract the first number from a CSS value like "4px", "1.5rem", "0".
// Returns null if no number is present (e.g. for color values).
export function parseNumericToken(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Compute the CSS emission for a single (tweak, target) pair. Returns null
// if the transform can't resolve (e.g. add/scale against a token missing
// from tokensMap) – the caller should skip emitting that pair.
export function emittedValueFor(
  tweak: Tweak,
  raw: string,
  target: string,
  tokensMap: TokensMap | null,
): string | null {
  const transform = resolvedTransform(tweak);
  if (transform === "set") return cssValueFor(tweak, raw);
  const base = parseNumericToken(tokensMap?.get(target));
  if (base === null) return null;
  const delta = parseFloat(raw);
  if (!Number.isFinite(delta)) return null;
  // resolvedTransform only returns "add"/"scale" for slider tweaks – at this
  // point in the function `transform` is non-"set", so the cast is sound.
  const unit = (tweak as { unit?: string }).unit ?? "";
  const next = transform === "add" ? base + delta : base * delta;
  // Trim trailing zeros so 6.00 reads as 6 (keeps promote-prompt output tidy).
  return `${+next.toFixed(4)}${unit}`;
}

// Build the `tweaks` bridge message: CSS variables for `:root` plus the
// attributes the frame sets on `<html>`. The frame only applies them.
export function tweakPayload(
  tweaks: Tweak[],
  values: Record<string, string>,
  tokensMap: TokensMap | null = null,
): TweakPayload {
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  for (const t of tweaks) {
    const raw = values[t.id] ?? defaultFor(t);
    // Discrete-valued tweaks also expose their value as data-{id} on <html>
    // so designs can switch CSS bundles per option via attribute selectors
    // (`:root[data-card-density="cozy"] { ... }`) without a JS shim. Slider
    // / color / text are continuous and stay variable-only.
    if (t.type === "select" || t.type === "toggle" || t.type === "state") {
      attrs[`data-${t.id.toLowerCase()}`] = cssValueFor(t, raw);
    }
    // If multiple state tweaks exist (rare), the last one wins – the docs
    // only commit to one at a time.
    if (t.type === "state") {
      attrs["data-state"] = cssValueFor(t, raw);
      continue;
    }
    for (const target of resolvedTargets(t)) {
      const emitted = emittedValueFor(t, raw, target, tokensMap);
      if (emitted !== null) vars[target] = emitted;
    }
  }
  return { vars, attrs };
}

