# AGENTS.md — cli-bench

## Project Overview

Single-file TypeScript CLI benchmarking tool that measures response times of AI coding assistants (Claude, Kilo, OpenCode). Runs via the Bun runtime with no build step, no package manager, and no external dependencies.

## Build & Run Commands

```bash
# Run the benchmark (only command needed)
bun bench.ts

# Type-check (requires bun types)
bunx tsc --noEmit bench.ts

# There is no build step — Bun executes .ts files natively
# There is no test suite, no lint config, and no formatter setup
```

### Runtime Requirements

- `bun` — runtime (must be installed globally)
- `claude` — Claude CLI (also used for question generation)
- `kilo` — Kilo CLI
- `opencode` — OpenCode CLI

All three target CLIs must be installed and available on `$PATH`.

## Architecture

- **Single file:** `bench.ts` (347 lines) — the entire program
- **No imports** — fully self-contained, uses only Bun built-in APIs (`Bun.spawn`, `performance.now`)
- **No npm/packages** — zero dependencies

### Execution Flow

1. **Phase 1 (Breadth):** Generate N trivia questions via Claude, run each once through all CLIs
2. **Phase 2 (Depth):** Pick one random question, run it 3 times through each CLI
3. Print formatted tables with timing stats (avg/min/max ms, success/fail counts)

### Key Constants

- `QUESTION_COUNT = 6` — questions to generate
- `RUNS = 3` — depth-phase repetitions per CLI
- `TIMEOUT_MS = 120_000` — 120s timeout per invocation

## Code Style Guidelines

### Formatting

- **Indentation:** Tabs (not spaces)
- **Strings:** Double quotes (`"`), not single quotes
- **No semicolons** — the file does not use statement-terminating semicolons
- **Trailing commas** in multi-line constructs (arrays, objects, function args)
- **Max line length:** ~100 characters; break long lines with one arg per line

### TypeScript Conventions

- **No `any`** — use proper types throughout
- **Type definitions** placed immediately before or at point of use (no separate types file)
- Use `type` aliases (not `interface`) for object shapes:
  ```typescript
  type CLI = {
  	name: string;
  	cmd: string;
  	args: (prompt: string) => string[];
  };
  ```
- **Return types** explicitly declared on exported/public async functions: `Promise<T>`
- **Error narrowing:** use `err instanceof Error ? err.message : String(err)` pattern
- **Numeric separators** for readability: `120_000` not `120000`

### Naming Conventions

- **Constants:** `UPPER_SNAKE_CASE` for module-level constants (`QUESTION_COUNT`, `TIMEOUT_MS`)
- **Types:** `PascalCase` (`RunResult`, `BenchResult`, `CLI`)
- **Functions:** `camelCase` (`runOnce`, `generateQuestions`, `printPhase1Matrix`)
- **Variables:** `camelCase` (`allResults`, `depthIdx`, `colWidths`)
- **Booleans** in types use `success`, `failures` (not `isSuccess`, `hasFailed`)

### Functions

- Small, focused functions — each does one thing
- Pure functions for formatting (`formatTable`) separate from I/O functions
- Async functions for subprocess spawning (`runOnce`, `generateQuestions`)
- Use `performance.now()` for timing (not `Date.now()`)

### Error Handling

- Subprocess failures return typed result objects (`{ success: false, error: string }`) — no thrown exceptions for expected failures
- Unexpected errors (e.g., question generation failure) throw `Error` with descriptive messages
- Include exit codes and stderr in error messages for debugging
- Use `AbortSignal.timeout()` for subprocess timeouts

### Process Spawning Pattern

Use `Bun.spawn()` with this standard shape:
```typescript
const proc = Bun.spawn([cmd, ...args], {
	stdout: "pipe",
	stderr: "pipe",
	stdin: "ignore",
	signal: AbortSignal.timeout(TIMEOUT_MS),
});
const exitCode = await proc.exited;
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
```

### Output Formatting

- Use `console.log()` for output lines
- Use `process.stdout.write()` for inline progress indicators (no trailing newline)
- Build table strings with `formatTable()` helper — pipes and dashes for borders
- Truncate long strings with ellipsis: `q.length > 40 ? q.slice(0, 37) + "..." : q`

## Project Conventions

- **No comments** in code — keep logic self-explanatory through clear naming
- **No external dependencies** — use only Bun and Node.js built-in APIs
- **Sequential execution** — CLIs are benchmarked one at a time, not in parallel, for fair timing
- **Deterministic structure, randomized depth** — breadth phase is ordered, depth phase picks a random question

## What Not To Do

- Do not add a `package.json`, `tsconfig.json`, or any config file without explicit request
- Do not add imports or external packages
- Do not parallelize subprocess calls — sequential execution is intentional for benchmark fairness
- Do not add semicolons — follow the existing no-semicolon style
- Do not add unit tests unless explicitly asked — this is a benchmarking tool, not a library
