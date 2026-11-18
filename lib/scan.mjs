// Stream Claude Code transcripts and aggregate token usage.
import { homedir } from "node:os";
import { join } from "node:path";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { emptyUsage, addUsage, readUsage, ratesFor, costOf } from "./cost.mjs";

export const PROJECTS = process.env.TOKENLENS_PROJECTS || join(homedir(), ".claude", "projects");

/** Every transcript under the projects dir, including subagent files. */
export function findTranscripts(root = PROJECTS, { includeSubagents = true } = {}) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!includeSubagents && (e.name === "subagents" || e.name === "workflows")) continue;
        walk(p, depth + 1);
      } else if (e.name.endsWith(".jsonl")) {
        out.push(p);
      }
    }
  };
  walk(root, 0);
  return out;
}

function bucketKey(d, by) {
  if (by === "day") return d.slice(0, 10);
  if (by === "month") return d.slice(0, 7);
  return d.slice(0, 10);
}

/**
 * Scan transcripts into aggregates.
 *
 * The critical correctness detail: the SAME assistant response can be written
 * to the transcript more than once (streaming rewrites, resumed sessions). In a
 * real tree over half of all requestIds repeat. Counting every line would
 * massively overstate spend, so each requestId is counted exactly once.
 */
export async function scan({
  files,
  prices,
  since = "",
  until = "",
  includeSubagents = true,
} = {}) {
  const seen = new Set();
  const byProject = new Map();
  const byModel = new Map();
  const byDay = new Map();
  const bySession = new Map();
  const byTool = new Map();
  const total = emptyUsage();
  let unknownModelTokens = 0;
  const unknownModels = new Set();
  let usd = 0;
  let duplicates = 0;
  let scanned = 0;

  const bump = (map, key, usage, cost, extra = {}) => {
    let row = map.get(key);
    if (!row) {
      row = { key, usage: emptyUsage(), usd: 0, ...extra };
      map.set(key, row);
    }
    addUsage(row.usage, usage);
    row.usd += cost;
    return row;
  };

  for (const file of files) {
    let rl;
    try {
      rl = createInterface({
        input: createReadStream(file, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
    } catch {
      continue;
    }

    let cwd = "";
    const isSub = file.includes("subagents") || file.includes("workflows");
    if (!includeSubagents && isSub) {
      rl.close();
      continue;
    }

    for await (const line of rl) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.cwd && !cwd) cwd = e.cwd;

      // Tool usage is counted per block, not per request — it is a frequency
      // signal, not a billing one, so duplicates matter less; still gated below.
      if (e.type !== "assistant") continue;
      const msg = e.message;
      if (!msg || !msg.usage) continue;

      const id = e.requestId || e.uuid;
      if (id) {
        if (seen.has(id)) {
          duplicates++;
          continue;
        }
        seen.add(id);
      }

      const day = (e.timestamp || "").slice(0, 10);
      if (since && day && day < since) continue;
      if (until && day && day > until) continue;

      const usage = readUsage(msg.usage);
      if (!usage) continue;
      scanned++;

      const model = msg.model || "unknown";
      const rates = ratesFor(prices, model);
      const { usd: c, known } = costOf(usage, rates);
      if (!known) {
        unknownModelTokens += usage.input + usage.output;
        if (model !== "<synthetic>") unknownModels.add(model);
      }

      addUsage(total, usage);
      usd += c;

      bump(byProject, cwd || "(unknown)", usage, c);
      bump(byModel, model, usage, c);
      if (day) bump(byDay, bucketKey(e.timestamp, "day"), usage, c);
      bump(bySession, e.sessionId || "(none)", usage, c, { cwd, day });

      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b && b.type === "tool_use") {
            const t = byTool.get(b.name) || { key: b.name, calls: 0 };
            t.calls++;
            byTool.set(b.name, t);
          }
        }
      }
    }
    rl.close();
  }

  return {
    total,
    usd,
    scanned,
    duplicates,
    unknownModelTokens,
    unknownModels: [...unknownModels],
    byProject,
    byModel,
    byDay,
    bySession,
    byTool,
  };
}
