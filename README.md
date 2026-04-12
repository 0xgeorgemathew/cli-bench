# cli-bench

Benchmark AI coding assistant CLIs against each other. Measures response times for Claude, Kilo, and OpenCode answering trivia questions.

## Quick Start

One command to clone and set up:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xgeorgemathew/cli-bench/main/quickstart.sh)
```

## Requirements

| Tool | Purpose | Install |
|------|---------|---------|
| [Bun](https://bun.sh) | Runtime | `curl -fsSL https://bun.sh/install \| bash` |
| [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) | Benchmark target | `npm install -g @anthropic-ai/claude-code` |
| [Kilo](https://kilo.dev) | Benchmark target | See kilo.dev |
| [OpenCode](https://opencode.ai) | Benchmark target | See opencode.ai |

All four must be on your `$PATH`.

## Usage

```bash
# Clone and install
git clone https://github.com/0xgeorgemathew/cli-bench.git
cd cli-bench
bun install

# Run the benchmark
bun bench.ts
```

## How It Works

1. **Question generation** — Claude generates 9 trivia questions
2. **Countdown** — 10-second countdown before benchmarking starts
3. **Breadth phase** — Each question is run once through every CLI, sequentially for fair timing
4. **Results** — Prints a comparison table with avg/min/max response times and success rates

### Configuration

Edit the constants at the top of `bench.ts`:

| Constant | Default | Description |
|----------|---------|-------------|
| `QUESTION_COUNT` | `9` | Number of questions to generate (must be divisible by CLI count) |
| `TIMEOUT_MS` | `120_000` | Timeout per CLI invocation (2 minutes) |
| `COUNTDOWN_SECONDS` | `10` | Countdown before benchmarking starts |

## License

MIT
