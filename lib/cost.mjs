// Pricing: load the table, resolve a model, cost one usage record.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadPrices(file) {
  const path = file || process.env.TOKENLENS_PRICES || join(HERE, "prices.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    defaults: raw._defaults || {
      cacheReadMultiplier: 0.1,
      cacheWrite5mMultiplier: 1.25,
      cacheWrite1hMultiplier: 2,
    },
    models: raw.models || {},
    path,
  };
}

/**
 * Resolve a model id to its rates. Unknown models return null, so the caller
 * can still report tokens and flag the cost as unknown rather than inventing one.
 */
export function ratesFor(prices, model) {
  if (!model || model === "<synthetic>") return null;
  const m = prices.models[model];
  if (!m) return null;
  const d = prices.defaults;
  return {
    input: m.input,
    output: m.output,
    cacheRead: m.cacheRead ?? m.input * d.cacheReadMultiplier,
    cacheWrite5m: m.cacheWrite5m ?? m.input * d.cacheWrite5mMultiplier,
    cacheWrite1h: m.cacheWrite1h ?? m.input * d.cacheWrite1hMultiplier,
  };
}

const M = 1_000_000;

/**
 * Cost one usage object. Returns { usd, known }.
 * `known` is false when the model has no price, so totals can say so honestly.
 */
export function costOf(usage, rates) {
  if (!rates) return { usd: 0, known: false };
  const w = usage.cacheWrite5m * rates.cacheWrite5m + usage.cacheWrite1h * rates.cacheWrite1h;
  const usd =
    (usage.input * rates.input +
      usage.output * rates.output +
      usage.cacheRead * rates.cacheRead +
      w) /
    M;
  return { usd, known: true };
}

export function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    thinking: 0,
    requests: 0,
  };
}

export function addUsage(a, b) {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite5m += b.cacheWrite5m;
  a.cacheWrite1h += b.cacheWrite1h;
  a.thinking += b.thinking;
  a.requests += b.requests;
  return a;
}

export function totalTokens(u) {
  return u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}

/** Normalise a raw transcript `usage` object into our flat shape. */
export function readUsage(raw) {
  if (!raw) return null;
  const cc = raw.cache_creation || {};
  // Older entries only have the flat total; split it into the 5m bucket.
  const w5 = cc.ephemeral_5m_input_tokens;
  const w1 = cc.ephemeral_1h_input_tokens;
  const flat = raw.cache_creation_input_tokens || 0;
  return {
    input: raw.input_tokens || 0,
    output: raw.output_tokens || 0,
    cacheRead: raw.cache_read_input_tokens || 0,
    cacheWrite5m: w5 === undefined && w1 === undefined ? flat : w5 || 0,
    cacheWrite1h: w1 || 0,
    thinking: (raw.output_tokens_details && raw.output_tokens_details.thinking_tokens) || 0,
    requests: 1,
  };
}
