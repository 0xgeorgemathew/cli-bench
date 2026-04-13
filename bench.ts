const QUESTION_COUNT = 9
const TIMEOUT_MS = 120_000
const COUNTDOWN_SECONDS = 10
const REPORT_PATH = "bench-report.html"

type NetworkInfo = {
	ip: string,
	city: string,
	region: string,
	country: string,
	org: string,
	timezone: string,
}

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

function printSummary(results: BenchResult[], clis: CLI[]): void {
	console.log("\n" + "=".repeat(70))
	console.log("RESULTS")
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

async function runBreadthPhase(questions: string[], clis: CLI[], questionsPerCli: number): Promise<BenchResult[]> {
	const results: BenchResult[] = []

	for (let ci = 0; ci < clis.length; ci++) {
		const cli = clis[ci]
		const offset = ci * questionsPerCli
		console.log(`--- ${cli.name} ---`)

		for (let qi = 0; qi < questionsPerCli; qi++) {
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

function generateHtmlReport(
	results: BenchResult[],
	clis: CLI[],
	stats: CliStats[],
	netInfo: NetworkInfo,
): string {
	const timestamp = new Date().toLocaleString()
	const labels = stats.map((s) => s.name)
	const avgData = stats.map((s) => +(s.avgMs / 1000).toFixed(2))
	const minData = stats.map((s) => +(s.minMs / 1000).toFixed(2))
	const maxData = stats.map((s) => +(s.maxMs / 1000).toFixed(2))
	const successData = stats.map((s) => s.successes)
	const failData = stats.map((s) => s.failures)

	const perQuestionLabels = results.map((r) => {
		const q = r.prompt.length > 40 ? r.prompt.slice(0, 37) + "..." : r.prompt
		return `${r.cli.name}: ${q}`
	})
	const perQuestionData = results.map((r) => +(r.run.timeMs / 1000).toFixed(2))
	const perQuestionColors = results.map((r) => {
		if (r.cli.name === "Claude") return "rgba(204,120,50,0.7)"
		if (r.cli.name === "Kilo") return "rgba(59,130,246,0.7)"
		return "rgba(139,92,246,0.7)"
	})

	const sorted = [...stats].sort((a, b) => a.avgMs - b.avgMs)
	const fastest = sorted[0]
	const ratio = sorted.length >= 2 && fastest.avgMs > 0
		? (sorted[sorted.length - 1].avgMs / fastest.avgMs).toFixed(2)
		: "1.00"

	const barColors = [
		"rgba(204,120,50,0.8)",
		"rgba(59,130,246,0.8)",
		"rgba(139,92,246,0.8)",
		"rgba(16,185,129,0.8)",
		"rgba(239,68,68,0.8)",
	]

	const resultsRows = results.map((r) => {
		const statusClass = r.run.success ? "ok" : "fail"
		const statusText = r.run.success ? "OK" : "FAIL"
		const q = r.prompt.length > 60 ? r.prompt.slice(0, 57) + "..." : r.prompt
		return `<tr>
			<td>${r.cli.name}</td>
			<td title="${r.prompt}">${q}</td>
			<td class="${statusClass}">${statusText}</td>
			<td>${(r.run.timeMs / 1000).toFixed(2)}s</td>
		</tr>`
	}).join("\n")

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CLI Benchmark Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		background: #0f172a;
		color: #e2e8f0;
		padding: 2rem;
		line-height: 1.6;
	}
	.container { max-width: 1200px; margin: 0 auto; }
	h1 {
		font-size: 2rem;
		background: linear-gradient(135deg, #f59e0b, #3b82f6);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		margin-bottom: 0.25rem;
	}
	.meta {
		color: #94a3b8;
		font-size: 0.85rem;
		margin-bottom: 2rem;
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
	}
	.meta span { display: flex; align-items: center; gap: 0.3rem; }
	.net-info {
		background: #1e293b;
		border: 1px solid #334155;
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 2rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
	}
	.net-info .label { color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.net-info .value { color: #f1f5f9; font-size: 0.95rem; font-weight: 500; }
	.highlight {
		background: linear-gradient(135deg, #1e293b, #1e293b);
		border: 1px solid #334155;
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 2rem;
		text-align: center;
	}
	.highlight .winner {
		font-size: 1.5rem;
		font-weight: 700;
		color: #10b981;
	}
	.highlight .detail { color: #94a3b8; margin-top: 0.25rem; }
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
		gap: 1.5rem;
		margin-bottom: 2rem;
	}
	.chart-card {
		background: #1e293b;
		border: 1px solid #334155;
		border-radius: 12px;
		padding: 1.5rem;
	}
	.chart-card h3 {
		color: #cbd5e1;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		background: #1e293b;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid #334155;
	}
	th {
		background: #334155;
		color: #94a3b8;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.75rem 1rem;
		text-align: left;
	}
	td {
		padding: 0.65rem 1rem;
		border-top: 1px solid #1e293b;
		font-size: 0.9rem;
	}
	tr:hover td { background: #263148; }
	.ok { color: #10b981; font-weight: 600; }
	.fail { color: #ef4444; font-weight: 600; }
	.section-title {
		font-size: 1.1rem;
		color: #cbd5e1;
		margin-bottom: 1rem;
		font-weight: 600;
	}
	@media (max-width: 600px) {
		.charts { grid-template-columns: 1fr; }
	}
</style>
</head>
<body>
<div class="container">
	<h1>CLI Benchmark Report</h1>
	<div class="meta">
		<span>&#x1F4C5; ${timestamp}</span>
		<span>&#x1F310; ${netInfo.ip}</span>
		<span>&#x1F3E2; ${netInfo.org}</span>
		<span>&#x1F30D; ${[netInfo.city, netInfo.region, netInfo.country].filter(Boolean).join(", ")}</span>
	</div>

	<div class="net-info">
		<div><div class="label">IP Address</div><div class="value">${netInfo.ip}</div></div>
		<div><div class="label">Organization</div><div class="value">${netInfo.org || "N/A"}</div></div>
		<div><div class="label">Location</div><div class="value">${[netInfo.city, netInfo.region, netInfo.country].filter(Boolean).join(", ") || "N/A"}</div></div>
		<div><div class="label">Timezone</div><div class="value">${netInfo.timezone || "N/A"}</div></div>
	</div>

	${fastest ? `<div class="highlight">
		<div class="winner">&#x1F3C6; ${fastest.name} wins!</div>
		<div class="detail">${ratio}x faster than ${sorted[sorted.length - 1].name} &mdash; avg ${(fastest.avgMs / 1000).toFixed(2)}s</div>
	</div>` : ""}

	<div class="charts">
		<div class="chart-card">
			<h3>Average Response Time (seconds)</h3>
			<canvas id="avgChart"></canvas>
		</div>
		<div class="chart-card">
			<h3>Min / Avg / Max Breakdown</h3>
			<canvas id="rangeChart"></canvas>
		</div>
		<div class="chart-card">
			<h3>Success vs Failure</h3>
			<canvas id="successChart"></canvas>
		</div>
		<div class="chart-card">
			<h3>Per-Question Response Time</h3>
			<canvas id="perQChart"></canvas>
		</div>
	</div>

	<h2 class="section-title">Detailed Results</h2>
	<table>
		<thead>
			<tr><th>CLI</th><th>Question</th><th>Status</th><th>Time</th></tr>
		</thead>
		<tbody>
			${resultsRows}
		</tbody>
	</table>
</div>
<script>
const barColors = ${JSON.stringify(barColors)};
const borderColors = barColors.map(c => c.replace("0.8", "1"));

new Chart(document.getElementById("avgChart"), {
	type: "bar",
	data: {
		labels: ${JSON.stringify(labels)},
		datasets: [{
			label: "Avg (s)",
			data: ${JSON.stringify(avgData)},
			backgroundColor: barColors.slice(0, ${labels.length}),
			borderColor: borderColors.slice(0, ${labels.length}),
			borderWidth: 1,
			borderRadius: 6,
		}],
	},
	options: {
		responsive: true,
		plugins: { legend: { display: false } },
		scales: {
			y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
			x: { ticks: { color: "#e2e8f0" }, grid: { display: false } },
		},
	},
});

new Chart(document.getElementById("rangeChart"), {
	type: "bar",
	data: {
		labels: ${JSON.stringify(labels)},
		datasets: [
			{ label: "Min (s)", data: ${JSON.stringify(minData)}, backgroundColor: "rgba(16,185,129,0.7)", borderRadius: 4 },
			{ label: "Avg (s)", data: ${JSON.stringify(avgData)}, backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4 },
			{ label: "Max (s)", data: ${JSON.stringify(maxData)}, backgroundColor: "rgba(239,68,68,0.7)", borderRadius: 4 },
		],
	},
	options: {
		responsive: true,
		plugins: { legend: { labels: { color: "#e2e8f0" } } },
		scales: {
			y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
			x: { ticks: { color: "#e2e8f0" }, grid: { display: false } },
		},
	},
});

new Chart(document.getElementById("successChart"), {
	type: "bar",
	data: {
		labels: ${JSON.stringify(labels)},
		datasets: [
			{ label: "Successes", data: ${JSON.stringify(successData)}, backgroundColor: "rgba(16,185,129,0.7)", borderRadius: 4 },
			{ label: "Failures", data: ${JSON.stringify(failData)}, backgroundColor: "rgba(239,68,68,0.7)", borderRadius: 4 },
		],
	},
	options: {
		responsive: true,
		plugins: { legend: { labels: { color: "#e2e8f0" } } },
		scales: {
			y: { beginAtZero: true, ticks: { color: "#94a3b8", stepSize: 1 }, grid: { color: "#334155" } },
			x: { ticks: { color: "#e2e8f0" }, grid: { display: false } },
		},
	},
});

new Chart(document.getElementById("perQChart"), {
	type: "bar",
	data: {
		labels: ${JSON.stringify(perQuestionLabels)},
		datasets: [{
			label: "Time (s)",
			data: ${JSON.stringify(perQuestionData)},
			backgroundColor: ${JSON.stringify(perQuestionColors)},
			borderRadius: 4,
		}],
	},
	options: {
		indexAxis: "y",
		responsive: true,
		plugins: { legend: { display: false } },
		scales: {
			x: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
			y: {
				ticks: { color: "#e2e8f0", font: { size: 10 } },
				grid: { display: false },
			},
		},
	},
});
</script>
</body>
</html>`
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

	console.log(`\nGenerating questions with Claude...`)
	const questions = await generateQuestions(QUESTION_COUNT)
	printQuestionPlan(questions, available, questionsPerCli)

	await countdown(COUNTDOWN_SECONDS)

	console.log("\nFetching network info...")
	const netInfo = await fetchNetworkInfo()
	console.log(`  IP: ${netInfo.ip} | Org: ${netInfo.org} | ${netInfo.city}, ${netInfo.region}, ${netInfo.country}`)

	const results = await runBreadthPhase(questions, available, questionsPerCli)
	printSummary(results, available)

	const allStats = computeStats(available, results)
	const html = generateHtmlReport(results, available, allStats, netInfo)
	const reportPath = `${import.meta.dir}/${REPORT_PATH}`
	await Bun.write(reportPath, html)
	console.log(`\nReport saved to ${reportPath}`)

	const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
	Bun.spawn([opener, reportPath], { stdout: "ignore", stderr: "ignore" })
}

main()
