#!/usr/bin/env node
// Started detached by acstack_restart_session: waits for the old Pi process to
// exit, then starts Pi on the same session in the same herdr pane.
// Usage: restart-session.mjs <old pid> <pane id> <agent name> <session file> [pi launch options...]
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [pid, pane, name, session, ...options] = process.argv.slice(2);
const herdr = process.env.HERDR_BIN_PATH || "herdr";
const prompt =
	"acstack restarted this Pi process on the same session to free memory. " +
	"Continue the work that was in progress; if there was none, wait for the user.";

const alive = () => {
	try {
		process.kill(Number(pid), 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
};

for (let waited = 0; alive(); waited += 100) {
	if (waited >= 60000) {
		console.error(`${new Date().toISOString()} Pi ${pid} still running after 60s; not restarting`);
		process.exit(1);
	}
	await sleep(100);
}

// The shell needs a moment to show its prompt, and herdr may still hold the old agent's name.
for (const attempt of [name, name, name, `${name.slice(0, 24)}-restart`]) {
	await sleep(1000);
	const run = spawnSync(herdr, ["agent", "start", attempt, "--kind", "pi", "--pane", pane, "--timeout", "60000", "--", ...options, "--session", session, prompt], { encoding: "utf-8" });
	console.log(`${new Date().toISOString()} herdr agent start ${attempt}: exit ${run.status}\n${run.stdout}${run.stderr}`);
	if (run.status === 0) process.exit(0);
}
console.error(`Could not start Pi. Run this in the pane: pi ${options.join(" ")} --session ${session}`);
process.exit(1);
