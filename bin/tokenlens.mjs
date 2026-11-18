#!/usr/bin/env node
// tokenlens — where did my Claude Code tokens go?
import { basename } from "node:path";
import { loadPrices } from "../lib/cost.mjs";
import { scan, findTranscripts, PROJECTS } from "../lib/scan.mjs";
import { totalTokens } from "../lib/cost.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("-") ? argv[0] : "summary";
const has = (f) => argv.includes(f);
const val = (f, d = "") => {
  const i = argv.indexOf(f);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

if (has("--help") || has("-h") || cmd === "help") {
  console.log(`tokenlens — where did my Claude Code tokens go?

usage: tokenlens [command] [options]

commands:
  summary          overall spend, with the biggest projects and models (default)
  projects         spend per project
  models           spend per model
  days             spend per day
  sessions         the most expensive individual sessions
  tools            which tools were called most
  prices           show the price table in use

options:
  --since YYYY-MM-DD    only count usage on or after this date
  --until YYYY-MM-DD    only count usage on or before this date
  --top N               rows to show (default 15)
  --no-subagents        skip subagent and workflow transcripts
  --prices FILE         use a different price table
  --json                machine-readable output
  --projects DIR        transcripts directory (default ~/.claude/projects)

Prices are a snapshot and may be stale; see 'tokenlens prices'.`);
  process.exit(0);
}

const prices = loadPrices(val("--prices") || undefined);

if (cmd === "prices") {
  console.log(`price table: ${prices.path}\n`);
  console.log(pad("model", 24) + rt("in $/Mtok", 12) + rt("out $/Mtok", 12));
  for (const [m, p] of Object.entries(prices.models)) {
    console.log(pad(m, 24) + rt(p.input.toFixed(2), 12) + rt(p.output.toFixed(2), 12));
  }
  console.log("\nCache reads default to 0.1x input; writes to 1.25x (5m) and 2x (1h).");
  console.log("Override with --prices <file> or TOKENLENS_PRICES.");
  process.exit(0);
}

const root = val("--projects") || PROJECTS;
const includeSubagents = !has("--no-subagents");
const files = findTranscripts(root, { includeSubagents });

if (!files.length) {
  console.error(`no transcripts found in ${root}`);
  process.exit(1);
}

const top = Number(val("--top", "15")) || 15;
const r = await scan({
  files,
  prices,
  since: val("--since"),
  until: val("--until"),
  includeSubagents,
});

if (has("--json")) {
  const ser = (m) =>
    [...m.values()].map((x) => ({ ...x, tokens: x.usage ? totalTokens(x.usage) : undefined }));
  console.log(
    JSON.stringify(
      {
        totalUsd: r.usd,
        totals: r.total,
        requests: r.scanned,
        duplicatesSkipped: r.duplicates,
        unknownModels: r.unknownModels,
        projects: ser(r.byProject),
        models: ser(r.byModel),
        days: ser(r.byDay),
        sessions: ser(r.bySession),
        tools: [...r.byTool.values()],
      },
      null,
      2
    )
  );
  process.exit(0);
}

const sorted = (m, key = (x) => x.usd) => [...m.values()].sort((a, b) => key(b) - key(a));

switch (cmd) {
  case "summary": {
    header();
    const t = r.total;
    const tok = totalTokens(t);
    const write = t.cacheWrite5m + t.cacheWrite1h;
    const row = (k, v, extra = "") => console.log("  " + pad(k, 14) + rt(n(v), 10) + extra);
    row("tokens", tok);
    row("  input", t.input);
    row("  output", t.output, t.thinking ? `  (${n(t.thinking)} thinking)` : "");
    row("  cache read", t.cacheRead, "  " + pct(t.cacheRead, tok));
    row("  cache write", write, "  " + pct(write, tok));
    row("requests", r.scanned);
    console.log(`\n  estimated cost  $${r.usd.toFixed(2)}`);
    if (t.cacheRead) {
      console.log(`  cache saved     ~$${savings(r).toFixed(2)} vs no caching`);
    }
    section("top projects", sorted(r.byProject).slice(0, 8), (x) => shortPath(x.key));
    section("by model", sorted(r.byModel), (x) => x.key);
    footer();
    break;
  }
  case "projects":
    header();
    section("projects", sorted(r.byProject).slice(0, top), (x) => shortPath(x.key));
    footer();
    break;
  case "models":
    header();
    section("models", sorted(r.byModel).slice(0, top), (x) => x.key);
    footer();
    break;
  case "days":
    header();
    section(
      "days",
      [...r.byDay.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-top),
      (x) => x.key
    );
    footer();
    break;
  case "sessions":
    header();
    section("sessions", sorted(r.bySession).slice(0, top), (x) =>
      `${x.day || "?"}  ${shortPath(x.cwd || "")}`.trim()
    );
    footer();
    break;
  case "tools": {
    header();
    const rows = [...r.byTool.values()].sort((a, b) => b.calls - a.calls).slice(0, top);
    const max = rows.length ? rows[0].calls : 1;
    console.log("\n  tool calls\n");
    for (const x of rows) {
      console.log(
        "  " + pad(x.key, 22) + rt(n(x.calls), 9) + "  " + bar(x.calls / max, 24)
      );
    }
    footer();
    break;
  }
  default:
    console.error(`unknown command: ${cmd} (try --help)`);
    process.exit(1);
}

// ---------- presentation ----------

function header() {
  console.log(`\ntokenlens  ·  ${files.length} transcript(s)  ·  ${root}\n`);
}

function footer() {
  const notes = [];
  if (r.duplicates) notes.push(`${n(r.duplicates)} duplicate request(s) skipped`);
  if (r.unknownModels.length) {
    notes.push(`no price for: ${r.unknownModels.join(", ")} (tokens counted, cost not)`);
  }
  notes.push("estimates from a local price table ('tokenlens prices'), at standard API rates");
  notes.push("on a Claude subscription this is what the usage WOULD cost on the API, not billed");
  console.log("\n  " + notes.join("\n  ") + "\n");
}

function section(title, rows, label) {
  if (!rows.length) return;
  const max = Math.max(...rows.map((x) => x.usd), 0.000001);
  console.log(`\n  ${title}\n`);
  for (const x of rows) {
    console.log(
      "  " +
        pad(label(x), 40) +
        rt("$" + x.usd.toFixed(2), 9) +
        rt(n(totalTokens(x.usage)), 12) +
        "  " +
        bar(x.usd / max, 16)
    );
  }
}

/** What the cache reads would have cost at full input price, minus what they did. */
function savings(res) {
  let saved = 0;
  for (const row of res.byModel.values()) {
    const m = prices.models[row.key];
    if (!m) continue;
    const readRate = m.cacheRead ?? m.input * prices.defaults.cacheReadMultiplier;
    saved += (row.usage.cacheRead * (m.input - readRate)) / 1_000_000;
  }
  return saved;
}

function bar(frac, width) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const full = Math.round(f * width);
  return "█".repeat(full) + "·".repeat(width - full);
}
function pad(s, w) {
  s = String(s);
  return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
}
function rt(s, w) {
  return String(s).padStart(w);
}
function n(x) {
  if (x >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "k";
  return String(x);
}
function pct(a, b) {
  return b ? `${((a / b) * 100).toFixed(0)}%` : "";
}
function shortPath(p) {
  if (!p) return "(unknown)";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? p : ".../" + parts.slice(-2).join("/") || basename(p);
}
