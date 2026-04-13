import type { CLI, BenchResult, CliStats, NetworkInfo, Phase, RunResult } from "./types"
import { generateHtmlReport } from "./report"

const QUESTION_COUNT = 9
const CONSISTENCY_COUNT = 3
const TIMEOUT_MS = 120_000
const COUNTDOWN_SECONDS = 10
const REPORT_PATH = "bench-report.html"

const CLIS: CLI[] = [
	{
		name: "Claude",
		cmd: "claude",
		model: "claude-sonnet-4-20250514",
		args: (prompt) => ["-p", prompt, "--output-format", "text"],
	},
	{
		name: "Kilo",
		cmd: "kilo",
		model: "glm-5.1",
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
		model: "default",
		args: (prompt) => ["run", prompt],
	},
]

async function filterAvailable(clis: CLI[]): Promise<CLI[]> {
	const available: CLI[] = []
	for (const cli of clis) {
		const proc = Bun.spawn(["which", cli.cmd], {
			stdout: "pipe",
			stderr: "pipe",
		})
		const code = await proc.exited
		if (code === 0) {
			available.push(cli)
		} else {
			console.log(`Skipping ${cli.name} — "${cli.cmd}" not found on PATH`)
		}
	}
	return available
}

async function fetchNetworkInfo(): Promise<NetworkInfo> {
	const empty: NetworkInfo = { ip: "unknown", city: "", region: "", country: "", org: "", timezone: "" }
	try {
		const proc = Bun.spawn(["curl", "-s", "https://ipinfo.io"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
			signal: AbortSignal.timeout(10_000),
		})
		const exitCode = await proc.exited
		if (exitCode !== 0) return empty
		const stdout = await new Response(proc.stdout).text()
		const data = JSON.parse(stdout) as Record<string, string>
		return {
			ip: data.ip ?? empty.ip,
			city: data.city ?? "",
			region: data.region ?? "",
			country: data.country ?? "",
			org: data.org ?? "",
			timezone: data.timezone ?? "",
		}
	} catch {
		return empty
	}
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

function printSummary(results: BenchResult[], clis: CLI[], label: string): void {
	console.log("\n" + "=".repeat(70))
	console.log(`${label.toUpperCase()} RESULTS`)
	console.log("=".repeat(70))

	const header = ["CLI", "Avg (s)", "Min (s)", "Max (s)", "OK", "Fail"]
	const stats = computeStats(clis, results)

	if (stats.length === 0) {
		console.log("No results to display.\n")
		return
	}

	console.log(formatTable(header, stats.map(statsToRow)))
	printComparison(stats)
	console.log()
}

function printQuestionPlan(questions: string[], clis: CLI[], questionsPerCli: number): void {
	console.log(`Generated ${questions.length} questions:\n`)
	questions.forEach((q, i) => {
		const cliIdx = Math.floor(i / questionsPerCli)
		const cliName = clis[cliIdx]?.name ?? "?"
		console.log(`  ${i + 1}. [${cliName}] ${q}`)
	})
}

async function runPhase(
	questions: string[],
	clis: CLI[],
	phase: Phase,
	layout: "split" | "shared",
): Promise<BenchResult[]> {
	const results: BenchResult[] = []
	const questionsPerCli = layout === "split"
		? Math.floor(questions.length / clis.length)
		: questions.length

	console.log(`--- ${phase} phase ---`)

	if (layout === "split") {
		for (let ci = 0; ci < clis.length; ci++) {
			const cli = clis[ci]
			const offset = ci * questionsPerCli
			console.log(`  ${cli.name}`)
			for (let qi = 0; qi < questionsPerCli; qi++) {
				const question = questions[offset + qi]
				process.stdout.write(`    Q${offset + qi + 1}...`)
				const run = await runOnce(cli, question)
				const status = run.success ? "OK" : "FAIL"
				console.log(` ${status} (${run.timeMs.toFixed(0)}ms)`)
				if (!run.success && run.error) {
					console.log(`      Error: ${run.error}`)
				}
				results.push({ cli, prompt: question, run, phase })
			}
		}
	} else {
		for (let qi = 0; qi < questions.length; qi++) {
			const question = questions[qi]
			console.log(`  Q${qi + 1}: ${question.length > 50 ? question.slice(0, 47) + "..." : question}`)
			for (const cli of clis) {
				process.stdout.write(`    ${cli.name}...`)
				const run = await runOnce(cli, question)
				const status = run.success ? "OK" : "FAIL"
				console.log(` ${status} (${run.timeMs.toFixed(0)}ms)`)
				if (!run.success && run.error) {
					console.log(`      Error: ${run.error}`)
				}
				results.push({ cli, prompt: question, run, phase })
			}
		}
	}

	return results
}

async function main(): Promise<void> {
	console.log("Checking available CLIs...\n")
	const available = await filterAvailable(CLIS)

	if (available.length === 0) {
		console.error(
			"No benchmarkable CLIs found. Install at least one of: claude, kilo, opencode",
		)
		process.exit(1)
	}

	const questionsPerCli = Math.floor(QUESTION_COUNT / available.length)

	if (QUESTION_COUNT % available.length !== 0) {
		throw new Error(
			`QUESTION_COUNT (${QUESTION_COUNT}) must be evenly divisible by available CLIs count (${available.length})`,
		)
	}

	console.log(`\nGenerating ${QUESTION_COUNT} breadth + ${CONSISTENCY_COUNT} consistency questions with Claude...`)
	const [breadthQuestions, consistencyQuestions] = await Promise.all([
		generateQuestions(QUESTION_COUNT),
		generateQuestions(CONSISTENCY_COUNT),
	])

	printQuestionPlan(breadthQuestions, available, questionsPerCli)
	console.log(`\nConsistency questions (same for all CLIs):`)
	consistencyQuestions.forEach((q, i) => {
		console.log(`  C${i + 1}. ${q}`)
	})

	await countdown(COUNTDOWN_SECONDS)

	console.log("\nFetching network info...")
	const netInfo = await fetchNetworkInfo()
	console.log(`  IP: ${netInfo.ip} | Org: ${netInfo.org} | ${netInfo.city}, ${netInfo.region}, ${netInfo.country}`)

	console.log("\n=== BREADTH PHASE ===")
	const breadthResults = await runPhase(breadthQuestions, available, "breadth", "split")
	printSummary(breadthResults, available, "breadth")

	console.log("=== CONSISTENCY PHASE ===")
	const consistencyResults = await runPhase(consistencyQuestions, available, "consistency", "shared")
	printSummary(consistencyResults, available, "consistency")

	const allResults = [...breadthResults, ...consistencyResults]
	const html = generateHtmlReport(allResults, available, netInfo)
	const reportPath = `${import.meta.dir}/${REPORT_PATH}`
	await Bun.write(reportPath, html)
	console.log(`\nReport saved to ${reportPath}`)

	const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
	Bun.spawn([opener, reportPath], { stdout: "ignore", stderr: "ignore" })
}

main()
