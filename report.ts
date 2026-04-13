import type { BenchResult, CLI, CliStats, NetworkInfo, Phase } from "./types"

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

function cliColor(name: string): string {
	if (name === "Claude") return "#FF6B9D"
	if (name === "Kilo") return "#4CC9F0"
	return "#7B2FBE"
}

const BAR_COLORS = ["#FF6B9D", "#4CC9F0", "#7B2FBE", "#9EF01A", "#FFE156"]

function buildResultsTable(results: BenchResult[], showModel: boolean): string {
	const rows = results.map((r) => {
		const statusClass = r.run.success ? "ok" : "fail"
		const statusText = r.run.success ? "OK" : "FAIL"
		const q = r.prompt.length > 60 ? r.prompt.slice(0, 57) + "..." : r.prompt
		const modelCell = showModel ? `<td>${r.cli.model}</td>` : ""
		return `<tr>
			<td class="cli-name">${r.cli.name}</td>
			${modelCell}
			<td title="${r.prompt}">${q}</td>
			<td class="${statusClass}">${statusText}</td>
			<td>${(r.run.timeMs / 1000).toFixed(2)}s</td>
		</tr>`
	}).join("\n")

	const modelHeader = showModel ? "<th>Model</th>" : ""

	return `<table>
		<thead>
			<tr><th>CLI</th>${modelHeader}<th>Question</th><th>Status</th><th>Time</th></tr>
		</thead>
		<tbody>
			${rows}
		</tbody>
	</table>`
}

function buildSummaryCharts(
	id: string,
	stats: CliStats[],
	phaseResults: BenchResult[],
	clis: CLI[],
): string {
	const labels = stats.map((s) => s.name)
	const avgData = stats.map((s) => +(s.avgMs / 1000).toFixed(2))
	const minData = stats.map((s) => +(s.minMs / 1000).toFixed(2))
	const maxData = stats.map((s) => +(s.maxMs / 1000).toFixed(2))
	const successData = stats.map((s) => s.successes)
	const failData = stats.map((s) => s.failures)

	const perQLabels = phaseResults.map((r) => {
		const q = r.prompt.length > 35 ? r.prompt.slice(0, 32) + "..." : r.prompt
		return `${r.cli.name}: ${q}`
	})
	const perQData = phaseResults.map((r) => +(r.run.timeMs / 1000).toFixed(2))
	const perQColors = phaseResults.map((r) => cliColor(r.cli.name))

	return `
	<div class="charts">
		<div class="chart-card">
			<h3>Avg Response Time</h3>
			<canvas id="${id}-avg"></canvas>
		</div>
		<div class="chart-card">
			<h3>Min / Avg / Max</h3>
			<canvas id="${id}-range"></canvas>
		</div>
		<div class="chart-card">
			<h3>Success vs Fail</h3>
			<canvas id="${id}-success"></canvas>
		</div>
		<div class="chart-card">
			<h3>Per-Question Time</h3>
			<canvas id="${id}-perq"></canvas>
		</div>
	</div>
	<script>
	(function() {
		var labels = ${JSON.stringify(labels)};
		var barColors = ${JSON.stringify(BAR_COLORS.slice(0, labels.length))};
		var perQLabels = ${JSON.stringify(perQLabels)};
		var perQData = ${JSON.stringify(perQData)};
		var perQColors = ${JSON.stringify(perQColors)};

		new Chart(document.getElementById("${id}-avg"), {
			type: "bar",
			data: {
				labels: labels,
				datasets: [{
					label: "Avg (s)",
					data: ${JSON.stringify(avgData)},
					backgroundColor: barColors,
					borderColor: "#1A1A1A",
					borderWidth: 2,
				}],
			},
			options: {
				responsive: true,
				plugins: { legend: { display: false } },
				scales: {
					y: { beginAtZero: true, grid: { color: "#E5E5E5" }, border: { width: 2 } },
					x: { grid: { display: false }, border: { width: 2 } },
				},
			},
		});

		new Chart(document.getElementById("${id}-range"), {
			type: "bar",
			data: {
				labels: labels,
				datasets: [
					{ label: "Min (s)", data: ${JSON.stringify(minData)}, backgroundColor: "#9EF01A", borderColor: "#1A1A1A", borderWidth: 2 },
					{ label: "Avg (s)", data: ${JSON.stringify(avgData)}, backgroundColor: "#4CC9F0", borderColor: "#1A1A1A", borderWidth: 2 },
					{ label: "Max (s)", data: ${JSON.stringify(maxData)}, backgroundColor: "#FF4444", borderColor: "#1A1A1A", borderWidth: 2 },
				],
			},
			options: {
				responsive: true,
				plugins: { legend: { labels: { usePointStyle: true, pointStyle: "rectRounded" } } },
				scales: {
					y: { beginAtZero: true, grid: { color: "#E5E5E5" }, border: { width: 2 } },
					x: { grid: { display: false }, border: { width: 2 } },
				},
			},
		});

		new Chart(document.getElementById("${id}-success"), {
			type: "bar",
			data: {
				labels: labels,
				datasets: [
					{ label: "OK", data: ${JSON.stringify(successData)}, backgroundColor: "#9EF01A", borderColor: "#1A1A1A", borderWidth: 2 },
					{ label: "FAIL", data: ${JSON.stringify(failData)}, backgroundColor: "#FF4444", borderColor: "#1A1A1A", borderWidth: 2 },
				],
			},
			options: {
				responsive: true,
				plugins: { legend: { labels: { usePointStyle: true, pointStyle: "rectRounded" } } },
				scales: {
					y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: "#E5E5E5" }, border: { width: 2 } },
					x: { grid: { display: false }, border: { width: 2 } },
				},
			},
		});

		new Chart(document.getElementById("${id}-perq"), {
			type: "bar",
			data: {
				labels: perQLabels,
				datasets: [{
					label: "Time (s)",
					data: perQData,
					backgroundColor: perQColors,
					borderColor: "#1A1A1A",
					borderWidth: 2,
				}],
			},
			options: {
				indexAxis: "y",
				responsive: true,
				plugins: { legend: { display: false } },
				scales: {
					x: { beginAtZero: true, grid: { color: "#E5E5E5" }, border: { width: 2 } },
					y: {
						ticks: { font: { size: 10 } },
						grid: { display: false },
						border: { width: 2 },
					},
				},
			},
		});
	})();
	</script>`
}

function buildConsistencyComparison(
	consistencyResults: BenchResult[],
	clis: CLI[],
): string {
	const prompts = [...new Set(consistencyResults.map((r) => r.prompt))]
	const labels = prompts.map((p) => (p.length > 40 ? p.slice(0, 37) + "..." : p))

	const datasets = clis.map((cli) => {
		const data = prompts.map((prompt) => {
			const result = consistencyResults.find(
				(r) => r.cli.name === cli.name && r.prompt === prompt,
			)
			return result ? +(result.run.timeMs / 1000).toFixed(2) : 0
		})
		return {
			label: cli.name,
			data,
			backgroundColor: cliColor(cli.name),
			borderColor: "#1A1A1A",
			borderWidth: 2,
		}
	})

	return `
	<div class="chart-card" style="margin-bottom: 1.5rem">
		<h3>Same-Question Comparison (consistency)</h3>
		<canvas id="consistency-comparison"></canvas>
	</div>
	<script>
	(function() {
		new Chart(document.getElementById("consistency-comparison"), {
			type: "bar",
			data: {
				labels: ${JSON.stringify(labels)},
				datasets: ${JSON.stringify(datasets)},
			},
			options: {
				responsive: true,
				plugins: { legend: { labels: { usePointStyle: true, pointStyle: "rectRounded" } } },
				scales: {
					y: {
						beginAtZero: true,
						title: { display: true, text: "Time (s)" },
						grid: { color: "#E5E5E5" },
						border: { width: 2 },
					},
					x: { grid: { display: false }, border: { width: 2 } },
				},
			},
		});
	})();
	</script>`
}

function buildPhaseSection(
	phase: Phase,
	results: BenchResult[],
	clis: CLI[],
): string {
	const stats = computeStats(clis, results)
	const title = phase === "breadth" ? "Breadth Test" : "Consistency Test"
	const desc = phase === "breadth"
		? "Each CLI answered different questions — measures throughput under varied workload."
		: "All CLIs answered the same 3 questions — measures head-to-head consistency."
	const sectionColor = phase === "breadth" ? "#FF6B9D" : "#4CC9F0"
	const badge = phase === "breadth" ? `${results.length} runs` : `${results.length} runs (same questions)`

	const sorted = [...stats].sort((a, b) => a.avgMs - b.avgMs)
	const fastest = sorted[0]
	const ratio = sorted.length >= 2 && fastest.avgMs > 0
		? (sorted[sorted.length - 1].avgMs / fastest.avgMs).toFixed(2)
		: "1.00"

	let winnerHtml = ""
	if (fastest) {
		winnerHtml = `<div class="phase-winner">
			<span class="phase-winner-label">${fastest.name} leads</span>
			<span class="phase-winner-detail">${ratio}x faster than ${sorted[sorted.length - 1].name} &mdash; avg ${(fastest.avgMs / 1000).toFixed(2)}s</span>
		</div>`
	}

	return `
	<div class="phase-section">
		<div class="phase-header">
			<h2 class="section-title" style="border-left-color: ${sectionColor}">${title}</h2>
			<span class="phase-badge">${badge}</span>
		</div>
		<p class="phase-desc">${desc}</p>
		${winnerHtml}
		${buildSummaryCharts(phase, stats, results, clis)}
		${phase === "consistency" ? buildConsistencyComparison(results, clis) : ""}
		<h3 class="subsection-title">Detailed Results</h3>
		${buildResultsTable(results, phase === "consistency")}
	</div>`
}

export function generateHtmlReport(
	results: BenchResult[],
	clis: CLI[],
	netInfo: NetworkInfo,
): string {
	const timestamp = new Date().toLocaleString()
	const breadthResults = results.filter((r) => r.phase === "breadth")
	const consistencyResults = results.filter((r) => r.phase === "consistency")
	const allStats = computeStats(clis, results)

	const sorted = [...allStats].sort((a, b) => a.avgMs - b.avgMs)
	const fastest = sorted[0]
	const overallRatio = sorted.length >= 2 && fastest.avgMs > 0
		? (sorted[sorted.length - 1].avgMs / fastest.avgMs).toFixed(2)
		: "1.00"

	const totalRuns = results.length
	const totalOk = results.filter((r) => r.run.success).length
	const totalFail = totalRuns - totalOk

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CLI Benchmark Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
	@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');

	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		font-family: 'Space Grotesk', sans-serif;
		background: #FFFDF5;
		color: #1A1A1A;
		padding: 2rem;
		line-height: 1.6;
	}
	.container { max-width: 1200px; margin: 0 auto; }
	h1 {
		font-family: 'Space Mono', monospace;
		font-size: 2.5rem;
		font-weight: 700;
		color: #1A1A1A;
		border-bottom: 4px solid #1A1A1A;
		padding-bottom: 0.5rem;
		margin-bottom: 0.25rem;
		display: inline-block;
		transform: rotate(-1deg);
	}
	.meta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 2rem;
	}
	.meta span {
		display: inline-block;
		font-family: 'Space Mono', monospace;
		font-size: 0.8rem;
		background: #fff;
		border: 3px solid #1A1A1A;
		padding: 0.4rem 0.8rem;
		box-shadow: 4px 4px 0 #1A1A1A;
	}
	.net-info {
		background: #fff;
		border: 3px solid #1A1A1A;
		box-shadow: 6px 6px 0 #1A1A1A;
		padding: 1.5rem;
		margin-bottom: 2rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
	}
	.net-info .item {
		border: 2px solid #1A1A1A;
		padding: 0.75rem 1rem;
		background: #F0FFF4;
	}
	.net-info .label {
		font-family: 'Space Mono', monospace;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #7B7B7B;
		margin-bottom: 0.25rem;
	}
	.net-info .value {
		font-weight: 700;
		font-size: 0.95rem;
	}
	.highlight {
		background: #FFE156;
		border: 4px solid #1A1A1A;
		box-shadow: 8px 8px 0 #1A1A1A;
		padding: 2rem;
		margin-bottom: 2rem;
		text-align: center;
	}
	.highlight .winner {
		font-family: 'Space Mono', monospace;
		font-size: 2rem;
		font-weight: 700;
		color: #1A1A1A;
	}
	.highlight .detail {
		font-family: 'Space Mono', monospace;
		color: #555;
		margin-top: 0.5rem;
		font-size: 0.9rem;
	}
	.highlight .totals {
		font-family: 'Space Mono', monospace;
		color: #888;
		margin-top: 0.5rem;
		font-size: 0.8rem;
	}
	.phase-section {
		background: #fff;
		border: 3px solid #1A1A1A;
		box-shadow: 6px 6px 0 #1A1A1A;
		padding: 2rem;
		margin-bottom: 2rem;
	}
	.phase-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.phase-badge {
		font-family: 'Space Mono', monospace;
		font-size: 0.7rem;
		background: #1A1A1A;
		color: #FFFDF5;
		padding: 0.2rem 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.phase-desc {
		color: #666;
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
	}
	.phase-winner {
		background: #F0FFF4;
		border: 2px solid #9EF01A;
		padding: 1rem 1.5rem;
		margin-bottom: 1.5rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.phase-winner-label {
		font-family: 'Space Mono', monospace;
		font-weight: 700;
		font-size: 1.1rem;
	}
	.phase-winner-detail {
		font-family: 'Space Mono', monospace;
		font-size: 0.8rem;
		color: #666;
	}
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}
	.chart-card {
		background: #FFFDF5;
		border: 3px solid #1A1A1A;
		box-shadow: 4px 4px 0 #1A1A1A;
		padding: 1.5rem;
	}
	.chart-card:nth-child(1) { background: #FFF0F5; }
	.chart-card:nth-child(2) { background: #F0F8FF; }
	.chart-card:nth-child(3) { background: #F5FFF0; }
	.chart-card:nth-child(4) { background: #FFF8F0; }
	.chart-card h3 {
		font-family: 'Space Mono', monospace;
		font-size: 0.85rem;
		margin-bottom: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 2px dashed #1A1A1A;
		padding-bottom: 0.5rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		background: #fff;
		border: 3px solid #1A1A1A;
		box-shadow: 4px 4px 0 #1A1A1A;
		margin-bottom: 1rem;
	}
	th {
		font-family: 'Space Mono', monospace;
		background: #1A1A1A;
		color: #FFFDF5;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		padding: 0.75rem 1rem;
		text-align: left;
	}
	td {
		padding: 0.65rem 1rem;
		border-bottom: 2px solid #E5E5E5;
		font-size: 0.9rem;
	}
	tr:last-child td { border-bottom: none; }
	tr:hover td { background: #FFE156; }
	.cli-name {
		font-family: 'Space Mono', monospace;
		font-weight: 700;
	}
	.ok {
		color: #1A1A1A;
		font-weight: 700;
		background: #9EF01A;
		border: 2px solid #1A1A1A;
		padding: 0.15rem 0.5rem;
		display: inline-block;
		box-shadow: 2px 2px 0 #1A1A1A;
	}
	.fail {
		color: #FFFDF5;
		font-weight: 700;
		background: #FF4444;
		border: 2px solid #1A1A1A;
		padding: 0.15rem 0.5rem;
		display: inline-block;
		box-shadow: 2px 2px 0 #1A1A1A;
	}
	.section-title {
		font-family: 'Space Mono', monospace;
		font-size: 1.1rem;
		color: #1A1A1A;
		font-weight: 700;
		border-left: 6px solid #FF6B9D;
		padding-left: 0.75rem;
	}
	.subsection-title {
		font-family: 'Space Mono', monospace;
		font-size: 0.9rem;
		color: #1A1A1A;
		font-weight: 700;
		margin-bottom: 1rem;
		padding-top: 0.5rem;
		border-top: 2px dashed #E5E5E5;
	}
	.footer {
		margin-top: 3rem;
		padding-top: 1rem;
		border-top: 3px dashed #1A1A1A;
		font-family: 'Space Mono', monospace;
		font-size: 0.75rem;
		color: #999;
		text-align: center;
	}
	@media (max-width: 600px) {
		.charts { grid-template-columns: 1fr; }
		h1 { font-size: 1.8rem; }
		body { padding: 1rem; }
		.phase-winner { flex-direction: column; gap: 0.5rem; text-align: center; }
	}
</style>
</head>
<body>
<div class="container">
	<h1>CLI BENCH</h1>
	<div class="meta">
		<span>${timestamp}</span>
		<span>${netInfo.ip}</span>
		<span>${netInfo.org}</span>
		<span>${[netInfo.city, netInfo.region, netInfo.country].filter(Boolean).join(", ")}</span>
	</div>

	<div class="net-info">
		<div class="item"><div class="label">IP Address</div><div class="value">${netInfo.ip}</div></div>
		<div class="item"><div class="label">Organization</div><div class="value">${netInfo.org || "N/A"}</div></div>
		<div class="item"><div class="label">Location</div><div class="value">${[netInfo.city, netInfo.region, netInfo.country].filter(Boolean).join(", ") || "N/A"}</div></div>
		<div class="item"><div class="label">Timezone</div><div class="value">${netInfo.timezone || "N/A"}</div></div>
	</div>

	${fastest ? `<div class="highlight">
		<div class="winner">&gt;&gt; ${fastest.name} WINS (overall) &lt;&lt;</div>
		<div class="detail">${overallRatio}x faster than ${sorted[sorted.length - 1].name} &mdash; avg ${(fastest.avgMs / 1000).toFixed(2)}s</div>
		<div class="totals">${totalRuns} total runs &middot; ${totalOk} OK &middot; ${totalFail} FAIL</div>
	</div>` : ""}

	${buildPhaseSection("breadth", breadthResults, clis)}
	${buildPhaseSection("consistency", consistencyResults, clis)}

	<div class="footer">cli-bench &mdash; raw numbers, no spin</div>
</div>
<script>
Chart.defaults.font.family = "'Space Mono', monospace";
Chart.defaults.color = "#1A1A1A";
</script>
</body>
</html>`
}
