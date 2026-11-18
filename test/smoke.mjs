#!/usr/bin/env node
// Dependency-free tests. Run: node test/smoke.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrices, ratesFor, costOf, readUsage, emptyUsage, addUsage, totalTokens } from "../lib/cost.mjs";
import { scan, findTranscripts } from "../lib/scan.mjs";

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    failed++;
  }
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "mismatch"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const near = (a, b, m, tol = 1e-9) => {
  if (Math.abs(a - b) > tol) throw new Error(`${m}: got ${a}, want ${b}`);
};
const ok = (v, m) => {
  if (!v) throw new Error(m || "expected truthy");
};

const prices = loadPrices();

console.log("pricing");

check("known model resolves rates", () => {
  const r = ratesFor(prices, "claude-opus-5");
  eq(r.input, 5, "input");
  eq(r.output, 25, "output");
});

check("cache rates derive from documented multipliers", () => {
  const r = ratesFor(prices, "claude-opus-5");
  near(r.cacheRead, 0.5, "read = 0.1x input");
  near(r.cacheWrite5m, 6.25, "5m write = 1.25x input");
  near(r.cacheWrite1h, 10, "1h write = 2x input");
});

check("an explicit cacheRead overrides the multiplier", () => {
  // opus-5-5 publishes $0.20, which is NOT 0.1x its $4 input.
  near(ratesFor(prices, "claude-opus-5-5").cacheRead, 0.2, "explicit read");
});

check("unknown and synthetic models have no rates", () => {
  eq(ratesFor(prices, "no-such-model"), null, "unknown");
  eq(ratesFor(prices, "<synthetic>"), null, "synthetic");
});

check("cost maths is right", () => {
  const u = { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 1 };
  const { usd, known } = costOf(u, ratesFor(prices, "claude-opus-5"));
  ok(known, "should be known");
  near(usd, 30, "1M in + 1M out at 5/25");
});

check("unknown model costs nothing but is flagged", () => {
  const u = { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 1 };
  const { usd, known } = costOf(u, null);
  eq(usd, 0, "usd");
  eq(known, false, "known");
});

console.log("usage parsing");

check("splits 5m and 1h cache writes", () => {
  const u = readUsage({
    input_tokens: 2,
    output_tokens: 10,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 50,
    cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 },
  });
  eq(u.cacheWrite5m, 20, "5m");
  eq(u.cacheWrite1h, 30, "1h");
  eq(u.cacheRead, 100, "read");
});

check("falls back to the flat cache total when no split is given", () => {
  const u = readUsage({ input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 77 });
  eq(u.cacheWrite5m, 77, "flat goes to 5m");
  eq(u.cacheWrite1h, 0, "1h");
});

check("reads thinking tokens", () => {
  eq(readUsage({ output_tokens: 10, output_tokens_details: { thinking_tokens: 4 } }).thinking, 4);
});

check("missing fields default to zero", () => {
  const u = readUsage({});
  eq(totalTokens(u), 0, "total");
});

console.log("scanning");

const dir = mkdtempSync(join(tmpdir(), "tokenlens-test-"));
const proj = join(dir, "C--demo");
mkdirSync(proj, { recursive: true });

const entry = (reqId, out, ts = "2026-01-01T00:00:00.000Z") =>
  JSON.stringify({
    type: "assistant",
    requestId: reqId,
    sessionId: "s1",
    cwd: "C:\\demo",
    timestamp: ts,
    message: {
      role: "assistant",
      model: "claude-opus-5",
      usage: { input_tokens: 0, output_tokens: out },
      content: [{ type: "tool_use", name: "Bash" }],
    },
  });

writeFileSync(
  join(proj, "a.jsonl"),
  [
    entry("req-1", 1e6),
    entry("req-1", 1e6), // the duplicate that would double the bill
    entry("req-2", 1e6, "2026-02-01T00:00:00.000Z"),
    "not json at all",
    "",
  ].join("\n")
);

const files = findTranscripts(dir);

check("finds transcripts", () => eq(files.length, 1, "count"));

const r = await scan({ files, prices });

check("duplicate requestIds are skipped", () => {
  eq(r.scanned, 2, "requests counted");
  eq(r.duplicates, 1, "duplicates");
});

check("cost reflects deduped requests only", () => {
  near(r.usd, 50, "2 x 1M output at $25");
});

check("malformed lines do not break the scan", () => {
  eq(r.total.output, 2e6, "output tokens");
});

check("groups by project, model, day and session", () => {
  eq([...r.byProject.keys()], ["C:\\demo"], "project");
  eq([...r.byModel.keys()], ["claude-opus-5"], "model");
  eq([...r.byDay.keys()].sort(), ["2026-01-01", "2026-02-01"], "days");
  eq([...r.bySession.keys()], ["s1"], "session");
});

check("counts tool calls", () => {
  eq(r.byTool.get("Bash").calls, 2, "bash calls");
});

const since = await scan({ files, prices, since: "2026-02-01" });
check("--since filters by date", () => {
  eq(since.scanned, 1, "requests");
  near(since.usd, 25, "one request");
});

const until = await scan({ files, prices, until: "2026-01-31" });
check("--until filters by date", () => eq(until.scanned, 1, "requests"));

check("a missing directory scans cleanly", () => {
  eq(findTranscripts(join(dir, "nope")).length, 0, "no files");
});

check("usage adds up", () => {
  const a = emptyUsage();
  addUsage(a, { input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 5, thinking: 6, requests: 1 });
  eq(totalTokens(a), 15, "total excludes thinking (already in output)");
});

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
