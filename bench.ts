const QUESTION_COUNT = 9
const TIMEOUT_MS = 120_000
const COUNTDOWN_SECONDS = 10

type CLI = {
	name: string,
	cmd: string,
	args: (prompt: string) => string[],
}

const CLIS: CLI[] = [
	{
		name: "Claude",
		cmd: "claude",
		args: (prompt) => ["-p", prompt, "--output-format", "text"],
	},
	{
		name: "Kilo",
		cmd: "kilo",
		args: (prompt) => [
			"run",
			"-m",
			"zai-coding-plan/glm-5.1",
			prompt,
			"--auto",
		],
	},
	{
		name: "OpenCode",
		cmd: "opencode",
		args: (prompt) => ["run", prompt],
	},
]

const QUESTIONS_PER_CLI = Math.floor(QUESTION_COUNT / CLIS.length)

if (QUESTION_COUNT % CLIS.length !== 0) {
	throw new Error(
		`QUESTION_COUNT (${QUESTION_COUNT}) must be evenly divisible by CLIs count (${CLIS.length})`,
	)
}

async function generateQuestions(count: number): Promise<string[]> {
	const genPrompt = `Generate exactly ${count} simple factual Q&A questions. Each question should be on its own line, numbered like "1. ...". Do not include answers. Just the questions. Topics: general knowledge, math, science, geography, history. Keep each question under 100 characters.`

	const proc = Bun.spawn(
		["claude", "-p", genPrompt, "--output-format", "text"],
		{
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	)
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()

	if (exitCode !== 0) {
		throw new Error(`Question generation failed (exit ${exitCode})`)
	}

	const questions = stdout
		.split("\n")
		.map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
		.filter((line) => line.length > 0)

	if (questions.length < count) {
		throw new Error(
			`Expected ${count} questions, got ${questions.length}: ${stdout}`,
		)
	}

	return questions.slice(0, count)
}

async function countdown(seconds: number): Promise<void> {
	for (let i = seconds; i > 0; i--) {
		process.stdout.write(`\rStarting in ${i}...`)
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}
	console.log("\rStarting now!      \n")
}

type RunResult = {
	success: boolean,
	timeMs: number,
	error?: string,
	output?: string,
}

async function runOnce(cli: CLI, prompt: string): Promise<RunResult> {
	const start = performance.now()
	try {
		const proc = Bun.spawn([cli.cmd, ...cli.args(prompt)], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		const exitCode = await proc.exited
		const elapsed = performance.now() - start
		const stdout = await new Response(proc.stdout).text()
		const stderr = await new Response(proc.stderr).text()

		if (exitCode !== 0) {
			return {
				success: false,
				timeMs: elapsed,
				error: `Exit code ${exitCode}: ${stderr.trim()}`,
			}
		}

		return {
			success: true,
			timeMs: elapsed,
			output: stdout.trim(),
		}
	} catch (err) {
		const elapsed = performance.now() - start
		return {
			success: false,
			timeMs: elapsed,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

type BenchResult = {
	cli: CLI,
	prompt: string,
	run: RunResult,
}

type CliStats = {
	name: string,
	avgMs: number,
	minMs: number,
	maxMs: number,
	successes: number,
	failures: number,
}

function computeStats(clis: CLI[], results: BenchResult[]): CliStats[] {
	const stats: CliStats[] = []
	for (const cli of clis) {
		const cliResults = results.filter((r) => r.cli.name === cli.name)
		if (cliResults.length === 0) continue
		const times = cliResults.map((r) => r.run.timeMs)
		stats.push({
			name: cli.name,
			avgMs: times.reduce((a, b) => a + b, 0) / times.length,
			minMs: Math.min(...times),
			maxMs: Math.max(...times),
			successes: cliResults.filter((r) => r.run.success).length,
			failures: cliResults.filter((r) => !r.run.success).length,
		})
	}
	return stats
}

function statsToRow(stat: CliStats): string[] {
	const fmt = (ms: number) => (ms / 1000).toFixed(1)
	return [
		stat.name,
		fmt(stat.avgMs),
		fmt(stat.minMs),
		fmt(stat.maxMs),
		String(stat.successes),
		String(stat.failures),
	]
}

function formatTable(header: string[], rows: string[][]): string {
	const colWidths = header.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => r[i].length)),
	)
	const separator = colWidths.map((w) => "-".repeat(w + 2)).join("+")
	const formatRow = (cells: string[]) =>
		cells.map((c, i) => ` ${c.padEnd(colWidths[i])} `).join("|")
	return [formatRow(header), separator, ...rows.map(formatRow)].join("\n")
}

function printComparison(stats: CliStats[]): void {
	if (stats.length < 2) return
	const sorted = [...stats].sort((a, b) => a.avgMs - b.avgMs)
	const fastest = sorted[0]
	const slowest = sorted[sorted.length - 1]
	if (fastest.avgMs > 0) {
		const ratio = (slowest.avgMs / fastest.avgMs).toFixed(2)
		console.log(
			`\n${fastest.name} is ${ratio}x faster than ${slowest.name}.`,
		)
	}
}

function printSummary(results: BenchResult[]): void {
	console.log("\n" + "=".repeat(70))
	console.log("RESULTS")
	console.log("=".repeat(70))

	const header = ["CLI", "Avg (s)", "Min (s)", "Max (s)", "OK", "Fail"]
	const stats = computeStats(CLIS, results)

	if (stats.length === 0) {
		console.log("No results to display.\n")
		return
	}

	console.log(formatTable(header, stats.map(statsToRow)))
	printComparison(stats)
	console.log()
}

function printQuestionPlan(questions: string[]): void {
	console.log(`Generated ${questions.length} questions:\n`)
	questions.forEach((q, i) => {
		const cliIdx = Math.floor(i / QUESTIONS_PER_CLI)
		const cliName = CLIS[cliIdx]?.name ?? "?"
		console.log(`  ${i + 1}. [${cliName}] ${q}`)
	})
}

async function runBreadthPhase(questions: string[]): Promise<BenchResult[]> {
	const results: BenchResult[] = []

	for (let ci = 0; ci < CLIS.length; ci++) {
		const cli = CLIS[ci]
		const offset = ci * QUESTIONS_PER_CLI
		console.log(`--- ${cli.name} ---`)

		for (let qi = 0; qi < QUESTIONS_PER_CLI; qi++) {
			const question = questions[offset + qi]
			process.stdout.write(`  Q${offset + qi + 1} ${cli.name}...`)
			const run = await runOnce(cli, question)
			const status = run.success ? "OK" : "FAIL"
			console.log(` ${status} (${run.timeMs.toFixed(0)}ms)`)
			if (!run.success && run.error) {
				console.log(`    Error: ${run.error}`)
			}
			results.push({ cli, prompt: question, run })
		}
		console.log()
	}

	return results
}

async function main(): Promise<void> {
	console.log("Generating questions with Claude...")
	const questions = await generateQuestions(QUESTION_COUNT)
	printQuestionPlan(questions)

	await countdown(COUNTDOWN_SECONDS)

	const results = await runBreadthPhase(questions)
	printSummary(results)
}

main()
