# Contributing to tokenlens

## The one rule

No dependencies. It runs anywhere Node runs and can't rot because a transitive
package broke. A PR that adds one needs to say what it buys.

## Setup

```bash
git clone https://github.com/varun642002/tokenlens && cd tokenlens && node test/smoke.mjs
```

There is no build step.

## Before a PR

```bash
node test/smoke.mjs
```

Tests write to a temp directory and never touch your real transcripts. CI runs
them on Linux, macOS and Windows against Node 18, 20 and 22.

## Things to know

- **Dedupe by `requestId`.** The same response appears in a transcript more than
  once; over half of all request ids repeat in a real tree. Anything that
  aggregates usage must count each request once or the numbers are nonsense.
- **Stream, never read whole files.** Single transcripts reach hundreds of MB.
- **Never invent a price.** An unknown model has its tokens counted and its cost
  excluded, and the footer says so. Guessing produces confident wrong numbers.
- **Say what the number means.** On a subscription these are API-equivalent
  costs, not a bill, and the output must keep saying so.

## Prices

`lib/prices.json` is a snapshot. Updating it is a welcome PR — include the date
and where the figures came from.
