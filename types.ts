export type Phase = "breadth" | "consistency"

export type NetworkInfo = {
	ip: string,
	city: string,
	region: string,
	country: string,
	org: string,
	timezone: string,
}

export type CLI = {
	name: string,
	cmd: string,
	model: string,
	args: (prompt: string) => string[],
}

export type RunResult = {
	success: boolean,
	timeMs: number,
	error?: string,
	output?: string,
}

export type BenchResult = {
	cli: CLI,
	prompt: string,
	run: RunResult,
	phase: Phase,
}

export type CliStats = {
	name: string,
	avgMs: number,
	minMs: number,
	maxMs: number,
	successes: number,
	failures: number,
}
