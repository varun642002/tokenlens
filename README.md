<div align="center">

# 🔍 tokenlens

### Where did my Claude Code tokens go?

*Nobody can answer "why did that session cost $4?" — this answers it.*

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#)
[![Tests](https://img.shields.io/badge/tests-20-success.svg)](test/smoke.mjs)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Claude Code already records every token it spends, in the transcripts under
`~/.claude/projects`. Nothing reads them back. tokenlens does.

```text
tokenlens  ·  1115 transcript(s)

  tokens             1.17B
    input           572.4k
    output           2.86M  (829.7k thinking)
    cache read       1.14B  98%
    cache write     20.00M  2%
  requests            3.1k

  estimated cost  $590.92
  cache saved     ~$4112.59 vs no caching

  top projects

  .../Downloads/my-app                     $341.22     611.31M  ████████████████
  .../Downloads/api-service                $118.68      83.012M ███·············
  .../scratch/prototype                     $33.18      18.92M  █···············

  by model

  claude-opus-5                            $410.53     811.01M  ████████████████
  claude-sonnet-5                           $63.27     210.10M  ██··············
```

🔒 Runs entirely locally. Reads your transcripts, sends nothing anywhere.

## 🚀 Install

```bash
npx tokenlens
```

Or clone it — there's nothing to build:

```bash
git clone https://github.com/varun642002/tokenlens && node tokenlens/bin/tokenlens.mjs
```

## 🎮 Commands

| Command | Shows |
|---|---|
| `tokenlens` | Overall spend, biggest projects, model split (default) |
| `tokenlens projects` | Spend per project |
| `tokenlens models` | Spend per model |
| `tokenlens days` | Spend per day — find the expensive ones |
| `tokenlens sessions` | The most expensive individual sessions |
| `tokenlens tools` | Which tools get called most |
| `tokenlens prices` | The price table in use |

### Options

| Flag | Effect |
|---|---|
| `--since YYYY-MM-DD` | Only usage on or after this date |
| `--until YYYY-MM-DD` | Only usage on or before this date |
| `--top N` | Rows to show (default 15) |
| `--no-subagents` | Skip subagent and workflow transcripts |
| `--json` | Machine-readable output |
| `--prices FILE` | Use a different price table |
| `--projects DIR` | Transcripts directory |

```bash
tokenlens days --since 2026-11-01
```

```bash
tokenlens sessions --top 5
```

```bash
tokenlens --json > usage.json
```

## 💡 What it's good for

- **"Why was last month so expensive?"** → `tokenlens days`
- **"Which project is eating my budget?"** → `tokenlens projects`
- **"Is caching actually working?"** → the `cache read` percentage. High is good: cache reads cost a fraction of fresh input.
- **"Should I use a cheaper model here?"** → `tokenlens models` shows what each tier actually costs you.
- **"Which session went wrong?"** → `tokenlens sessions` finds the outlier.

## ⚠️ About the numbers

> [!IMPORTANT]
> **On a Claude subscription, this is not a bill.** It's what the same usage
> would cost at standard API rates. Useful for comparing projects, models and
> months — not a statement of what you paid.

> [!NOTE]
> **Prices are a local snapshot** and go stale. Run `tokenlens prices` to see
> the table, and override it with `--prices my-prices.json` or
> `TOKENLENS_PRICES`. A model with no price still has its tokens counted — the
> cost is excluded and the footer says so, rather than quietly guessing.

Cache reads default to 0.1× input and writes to 1.25× (5m TTL) and 2× (1h TTL),
except where a model publishes its own cache-read price.

## 🧭 How it works, and the one bug that matters

Each assistant turn in a transcript carries a `usage` object: input, output,
cache reads, cache writes split by TTL, and thinking tokens. tokenlens streams
every transcript line by line — gigabytes cost no more memory than kilobytes —
and sums them.

**The trap: the same response is often written to the transcript more than
once.** Streaming rewrites and resumed sessions duplicate entries. In a real
tree, scanning 1115 transcripts found **73,300 duplicate requests** — counting
them would have inflated the total several times over.

So every request is counted exactly once, keyed by `requestId`. The footer
reports how many duplicates were skipped. If you build anything on these
transcripts, this is the bug to know about.

## 🤝 Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). No dependencies, please.

Most useful contributions right now:

- [ ] Keeping `lib/prices.json` current
- [ ] Per-file attribution — which files consumed the most context
- [ ] An HTML report
- [ ] Budget alerts (`--budget 50` exits non-zero over the line)

## 📄 License

[MIT](LICENSE)
