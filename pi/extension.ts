/**
 * SpecHub on pi.
 *
 * The pi port of the Claude Code hooks in hooks/. Claude Code and Codex never
 * load this file, and nothing in hooks/ depends on it.
 *
 *   session_start        symlink the CLI, warn once if pi-subagents is
 *                        missing, and print the setup reminder outside a
 *                        spechub project            (hooks/session-start.sh)
 *   before_agent_start   add orchestrator/AGENTS.md to the system prompt in a
 *                        spechub project            (hooks/session-start.sh)
 *                        add the writing style and its per-turn reminder when
 *                        the user turned it on      (hooks/ac-writing-style-reminder.sh)
 *   agent_before_settle  nudge towards a handoff as context fills
 *                                                   (hooks/context-pressure.sh)
 *   session_compact      re-inject spechub/HANDOFF.md after a compaction, and
 *                        restart the nudge ladder   (hooks/session-start-handoff.sh,
 *                                                    hooks/context-pressure.sh)
 *
 * It also registers /spechub <skill>, a /spechub:<skill> command per skill,
 * and /spechub-writing-style on|off.
 *
 * Only type imports come from pi, so Node can strip the types and load this
 * file in tests/test-pi-extension.sh with a stub API.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const troubleshoot = path.join(packageRoot, "TROUBLESHOOTING.md");

/** pi-subagents' background runner sets this in every child process. */
const SUBAGENT_CHILD_ENV = "PI_SUBAGENT_CHILD";
/** pi-subagents sets this instead in a child it places in its own herdr pane. */
const HERDR_BRIDGE_CHILD_ENV = "PI_SUBAGENTS_HERDR_BRIDGE";

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function readText(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return undefined;
	}
}

function report(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else process.stderr.write(`${message}\n`);
}

// --------------------------------------------------------------------------
// CLI symlinks
// --------------------------------------------------------------------------

/**
 * Point `link` at `src`, with the non-clobber rules of link_cli in
 * hooks/session-start.sh: create when absent, retarget a stale symlink, and
 * never touch a real file.
 */
function linkCli(ctx: ExtensionContext, src: string, link: string, label: string): void {
	let current: string | undefined;
	let exists = false;
	try {
		const stat = fs.lstatSync(link);
		exists = true;
		if (stat.isSymbolicLink()) current = fs.readlinkSync(link);
	} catch {
		// Absent.
	}

	if (!exists) {
		try {
			fs.mkdirSync(path.dirname(link), { recursive: true });
			fs.symlinkSync(src, link);
			report(ctx, `spechub: linked ${label} at ${link} -> ${src}`);
		} catch {
			report(ctx, `spechub: failed to create symlink at ${link} – see ${troubleshoot} (section: command not found).`, "warning");
		}
		return;
	}

	if (current === undefined) {
		report(ctx, `spechub: ${link} exists but is not a symlink – not overwriting. See ${troubleshoot} (section: command not found).`, "warning");
		return;
	}

	if (current === src) return;
	try {
		const tmp = `${link}.spechub-${process.pid}`;
		fs.symlinkSync(src, tmp);
		fs.renameSync(tmp, link);
		// A repoint is routine after every upgrade, so it stays off the UI.
		process.stderr.write(`spechub: updated ${label} at ${link} -> ${src}\n`);
	} catch {
		report(ctx, `spechub: failed to update stale symlink at ${link} (was: ${current}) – see ${troubleshoot} (section: stale cache).`, "warning");
	}
}

/** The first executable `spechub` on PATH, like `command -v spechub`. */
function spechubOnPath(): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, "spechub");
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			if (fs.statSync(candidate).isFile()) return candidate;
		} catch {
			// Not here.
		}
	}
	return undefined;
}

function realpathOrSelf(file: string): string {
	try {
		return fs.realpathSync(file);
	} catch {
		return file;
	}
}

/**
 * The same two symlinks hooks/session-start.sh refreshes.
 *
 * Every skill and agent calls the CLI as ~/.claude/spechub/bin/spechub, so the
 * agent path keeps its Claude-flavoured location on pi too. With both Claude
 * Code and pi installed, each one points the symlink at its own copy on every
 * session start, so it flips between the two caches. Both copies are a
 * released CLI, so either target works.
 */
function linkClis(ctx: ExtensionContext): void {
	const wrapper = path.join(packageRoot, "cli", "bin", "spechub.js");
	const dist = path.join(packageRoot, "cli", "dist", "index.js");
	if (!fs.existsSync(wrapper)) return;
	if (!fs.existsSync(dist)) {
		report(ctx, `spechub: CLI is missing its built output (${dist}) – see ${troubleshoot} (section: ERR_MODULE_NOT_FOUND).`, "error");
		return;
	}

	const home = os.homedir();
	linkCli(ctx, wrapper, path.join(home, ".claude", "spechub", "bin", "spechub"), "agent CLI");

	// Defer to a spechub on PATH that someone else installed. The agent path
	// above is absolute, so it is never affected.
	const humanLink = path.join(home, ".local", "bin", "spechub");
	const onPath = spechubOnPath();
	// The shell hook says so on every session. pi shows each report as a
	// notification, so this stays silent instead.
	if (!onPath || onPath === humanLink || realpathOrSelf(onPath) === realpathOrSelf(humanLink)) {
		linkCli(ctx, wrapper, humanLink, "human CLI");
	}

	if (process.platform === "linux" || process.platform === "darwin") {
		const vmFreePort = path.join(packageRoot, "assets", "playwriter-bridge", "vm-free-port.sh");
		if (fs.existsSync(vmFreePort)) {
			linkCli(ctx, vmFreePort, path.join(home, ".claude", "spechub", "bin", "vm-free-port.sh"), "vm-free-port.sh");
		}
	}
}

// --------------------------------------------------------------------------
// Writing style
// --------------------------------------------------------------------------

const settingsFile = (): string => path.join(agentDir(), "spechub.json");

function readSettings(): { writingStyle?: boolean } {
	try {
		const parsed = JSON.parse(readText(settingsFile()) ?? "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeSettings(settings: { writingStyle?: boolean }): void {
	fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
	fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function stripFrontmatter(text: string): string {
	const match = /^---\n[\s\S]*?\n---\n/.exec(text);
	return (match ? text.slice(match[0].length) : text).trim();
}

/**
 * The per-turn reminder, extracted from the style file on every call so it
 * cannot drift. Mirrors the awk in hooks/ac-writing-style-reminder.sh line for
 * line: the top-level lines of "## Who you are", then "## Before you send" in
 * full. tests/test-pi-extension.sh checks the two produce the same text.
 */
export function extractWritingReminder(style: string): string | undefined {
	const out: string[] = [];
	let persona = false;
	let checklist = false;
	// awk sees no line after the file's final newline, so neither does this.
	for (const line of style.replace(/\n$/, "").split("\n")) {
		if (checklist) {
			out.push(line);
			continue;
		}
		if (line === "## Who you are") {
			persona = true;
			continue;
		}
		if (line === "## Shape: Minto pyramid") persona = false;
		if (persona && line.startsWith("### ")) {
			out.push("", line);
			continue;
		}
		if (persona && /^[*-]/.test(line)) {
			out.push(line);
			continue;
		}
		if (line === "## Before you send") {
			checklist = true;
			out.push("", line);
		}
	}
	if (out.length === 0) return undefined;
	return `ac-writing-style reminder\n\n${out.join("\n")}\n`;
}

// --------------------------------------------------------------------------
// Context pressure
// --------------------------------------------------------------------------

const DEFAULT_WARN = 200000;
const DEFAULT_SEVERE = 500000;
const DEFAULT_STEP = 100000;

const AGENCY =
	"The call is yours. If you have a strong view either way, act on it " +
	"without asking. Either hand over, or say in one line what you found " +
	"and carry on. Ask the user with the host's question tool if you don't " +
	"know if handing off or continuing in this session would be better.";

const STANDING_AGREEMENT =
	"If you are partway through a long run of tasks and the user already " +
	"agreed to a handoff earlier in this session, including in a handoff " +
	"or compaction summary you resumed from, hand over without asking.";

const DECIDE_TAIL =
	`${AGENCY} ${STANDING_AGREEMENT}` +
	" If you do ask and the user would rather keep going, drop it for now" +
	" and raise the handoff again once the current run of work wraps up.";

interface HandoffConfig {
	nudge_warn?: number;
	nudge_severe?: number;
	nudge_step?: number;
	context_window?: number;
	context_thresholds?: string[];
}

function flowList(value: string): string[] {
	let inner = value.trim();
	if (inner.startsWith("[")) inner = inner.slice(1);
	if (inner.endsWith("]")) inner = inner.slice(0, -1);
	return inner
		.split(",")
		.map((part) => part.trim().replace(/^["']+|["']+$/g, ""))
		.filter(Boolean);
}

/**
 * The workflow.handoff keys from spechub/project.yaml. A port of read_config
 * in hooks/context-pressure.sh, hand-rolled for the same reason: no YAML
 * library is guaranteed to be installed.
 */
export function readHandoffConfig(yaml: string | undefined): HandoffConfig {
	const cfg: HandoffConfig = {};
	if (yaml === undefined) return cfg;
	const stack: Array<[number, string]> = [];
	let collecting: number | undefined;
	for (const raw of yaml.split("\n")) {
		if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
		const stripped = raw.replace(/^ +/, "");
		const indent = raw.length - stripped.length;

		if (collecting !== undefined) {
			if (stripped.startsWith("- ") && indent >= collecting) {
				const item = stripped.slice(2).split("#")[0].trim().replace(/^["']+|["']+$/g, "");
				if (item) cfg.context_thresholds?.push(item);
				continue;
			}
			collecting = undefined;
		}

		if (stripped.startsWith("- ") || !stripped.includes(":")) continue;
		const sep = stripped.indexOf(":");
		const key = stripped.slice(0, sep).trim().replace(/^["']+|["']+$/g, "");
		const value = stripped.slice(sep + 1).split("#")[0].trim().replace(/^["']+|["']+$/g, "");

		while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
		const keyPath = [...stack.map(([, k]) => k), key];

		if (!value) {
			stack.push([indent, key]);
			if (keyPath.join(".") === "workflow.handoff.context_thresholds") {
				cfg.context_thresholds = [];
				collecting = indent;
			}
			continue;
		}

		if (keyPath.length !== 3 || keyPath[0] !== "workflow" || keyPath[1] !== "handoff") continue;
		if (key === "context_thresholds") {
			cfg.context_thresholds = flowList(value);
		} else if (key === "nudge_warn" || key === "nudge_severe" || key === "nudge_step" || key === "context_window") {
			const n = Number.parseInt(value, 10);
			if (/^-?\d+$/.test(value) && Number.isFinite(n)) cfg[key] = n;
		}
	}
	return cfg;
}

/**
 * The nudge for `tokens`, or undefined when no new rung was crossed. Same
 * ladder as hooks/context-pressure.sh. pi reports the model's real context
 * window, so a percentage rung resolves against that instead of a guess from
 * the model id.
 */
export function contextNudge(
	tokens: number,
	contextWindow: number,
	cfg: HandoffConfig,
	lastRung: number | undefined,
	inHerdr: boolean,
): { rung: number; reason: string } | undefined {
	const window = cfg.context_window && cfg.context_window > 0 ? cfg.context_window : contextWindow;
	// Unlike Claude Code, pi auto-compacts about 16k tokens short of the
	// window, so a 200k mark on a 200k model never fires. An unset mark
	// therefore also stays at or below half (warn) and 80% (severe) of the
	// window.
	const warnAt = Math.max(cfg.nudge_warn ?? Math.min(DEFAULT_WARN, Math.floor(window * 0.5)), 1);
	const severeAt = Math.max(cfg.nudge_severe ?? Math.min(DEFAULT_SEVERE, Math.floor(window * 0.8)), warnAt);
	const rawStep = cfg.nudge_step ?? DEFAULT_STEP;
	const step = rawStep < 1 ? undefined : rawStep;

	const resolve = (item: string): number | undefined => {
		const s = item.trim().replace(/^["']+|["']+$/g, "");
		if (s.endsWith("%")) {
			const percent = Number.parseFloat(s.slice(0, -1));
			return Number.isFinite(percent) ? Math.round((window * percent) / 100) : undefined;
		}
		return /^-?\d+$/.test(s) ? Number.parseInt(s, 10) : undefined;
	};

	let rungs = (cfg.context_thresholds ?? [])
		.map(resolve)
		.filter((r): r is number => r !== undefined && r >= 1);
	if (rungs.length === 0) rungs = [warnAt, severeAt];
	rungs = [...new Set(rungs)].sort((a, b) => a - b);

	const top = rungs[rungs.length - 1];
	let rung: number | undefined;
	if (tokens >= top) rung = step === undefined ? top : top + Math.floor((tokens - top) / step) * step;
	else rung = rungs.filter((r) => r <= tokens).pop();
	if (rung === undefined) return undefined;
	if (lastRung !== undefined && rung <= lastRung) return undefined;

	const route = inHerdr ? "the handoff skill" : "the compact-and-continue skill";
	const used = tokens.toLocaleString("en-US");
	const limit = rung.toLocaleString("en-US");
	const head =
		rung >= severeAt
			? `Context check (urgent): this session has used about ${used} tokens, ` +
				`past the ${limit} severe mark, so it is close to the wall. Handing ` +
				`the work over with ${route} is usually right this late, and starting ` +
				"something new rarely is. Finishing what you are already on can be " +
				"the better call though: wrap it up and there may be nothing left " +
				"worth handing over. If you do put it to the user, say plainly that " +
				"context is nearly gone so they can decide quickly."
			: `Context check: this session has used about ${used} tokens, past the ` +
				`${limit} mark. Decide whether now is a good moment to hand the work ` +
				`over with ${route}.`;
	return { rung, reason: `${head} ${DECIDE_TAIL}` };
}

/**
 * Ladder state shares its directory and file names with
 * hooks/context-pressure.sh. The handoff skill writes <session id>.quiet
 * there once the work is handed over.
 */
function pressureStateDir(): string {
	return process.env.SPECHUB_CONTEXT_PRESSURE_DIR || path.join(process.env.TMPDIR || "/tmp", "spechub-context-pressure");
}

function sessionKey(ctx: ExtensionContext): string | undefined {
	const id = ctx.sessionManager.getSessionId();
	if (!id || id.includes("\0")) return undefined;
	const key = path.basename(id.replace(/[\\/]/g, "_"));
	return key && key !== "." && key !== ".." ? key : undefined;
}

// --------------------------------------------------------------------------
// Handoff reload
// --------------------------------------------------------------------------

const HANDOFF_PREAMBLE =
	"The session was just compacted. The following SpecHub handoff captures " +
	"load-bearing work state the summary may have compressed. Treat it as " +
	"authoritative for what to do next.\n\n" +
	'Resume now: when the user\'s next message is "continue" (or any short ' +
	"nudge), pick up the work immediately from the Next action below - do not " +
	"wait for further instruction. If anything in this handoff or the " +
	"compaction summary is ambiguous or underspecified, ask the user " +
	"to resolve it before acting rather than guessing. Ask liberally: a " +
	"wrong assumption taken after compaction is expensive to unwind.\n\n";

/**
 * Consume spechub/HANDOFF.md the way hooks/session-start-handoff.sh does:
 * only a file carrying the spechub_handoff marker, moved into a per-map
 * archive so it is never injected twice. Returns the text to inject.
 */
export function consumeHandoff(cwd: string, now: Date = new Date()): string | undefined {
	const active = path.join(cwd, "spechub", "HANDOFF.md");
	const raw = readText(active);
	if (!raw?.trim()) return undefined;

	if (!raw.startsWith("---")) return undefined;
	const lines = raw.split("\n");
	const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
	if (end === -1) return undefined;
	const meta: Record<string, string> = {};
	for (const line of lines.slice(1, end)) {
		const sep = line.indexOf(":");
		if (sep !== -1) meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
	}
	const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
	if (!("spechub_handoff" in meta) || !body.trim()) return undefined;

	let map = (meta.map || meta.change || "ad-hoc").replace(/[^A-Za-z0-9._-]/g, "-");
	if (!map.replace(/^\.+|\.+$/g, "")) map = "ad-hoc";
	let stamp = (meta.created || "").replace(/[^A-Za-z0-9._-]/g, "-");
	if (!stamp) stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");

	const changeDir = path.join(cwd, "spechub", "changes", map);
	const archiveDir =
		map !== "ad-hoc" && fs.existsSync(changeDir)
			? path.join(changeDir, "handoffs")
			: path.join(cwd, "spechub", "handoffs", map);
	try {
		fs.mkdirSync(archiveDir, { recursive: true });
		let dest = path.join(archiveDir, `${stamp}.md`);
		for (let n = 2; fs.existsSync(dest); n++) dest = path.join(archiveDir, `${stamp}-${n}.md`);
		fs.renameSync(active, dest);
	} catch {
		// Best effort: inject anyway so the resume is not lost.
	}
	return HANDOFF_PREAMBLE + body;
}

// --------------------------------------------------------------------------
// Skill commands
// --------------------------------------------------------------------------

/** This package's skills, by name, from skills/<dir>/SKILL.md. */
export function listSkills(root: string = packageRoot): Map<string, string> {
	const skills = new Map<string, string>();
	const dir = path.join(root, "skills");
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return skills;
	}
	for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
		const file = path.join(dir, entry.name, "SKILL.md");
		const name = /^---\n[\s\S]*?^name:\s*(\S+)\s*$/m.exec(readText(file) ?? "")?.[1];
		if (name) skills.set(name, file);
	}
	return skills;
}

/**
 * The user message for one SpecHub skill, in the same shape pi's own
 * /skill:<name> expansion produces. Built from this package's file, so a
 * generic name such as map or commit that another package's skill took
 * first still runs the SpecHub skill.
 */
export function skillInvocation(name: string, file: string, args: string): string | undefined {
	const content = readText(file);
	if (content === undefined) return undefined;
	const block = `<skill name="${name}" location="${file}">\nReferences are relative to ${path.dirname(file)}.\n\n${stripFrontmatter(content)}\n</skill>`;
	return args.trim() ? `${block}\n\n${args.trim()}` : block;
}

// --------------------------------------------------------------------------
// The extension
// --------------------------------------------------------------------------

export default function spechub(pi: ExtensionAPI): void {
	// A background subagent loads every ambient extension. The orchestrator
	// prompt and the nudges belong to the lead session, never to a subagent.
	if (process.env[SUBAGENT_CHILD_ENV] === "1" || process.env[HERDR_BRIDGE_CHILD_ENV] === "1") return;

	const orchestratorFile = path.join(packageRoot, "orchestrator", "AGENTS.md");
	const styleFile = path.join(packageRoot, "output-styles", "ac-writing-style.md");
	const isProject = (cwd: string) => fs.existsSync(path.join(cwd, "spechub", "project.yaml"));
	let warnedSubagents = false;

	pi.on("session_start", async (event, ctx) => {
		linkClis(ctx);

		if (!warnedSubagents && !pi.getAllTools().some((tool) => tool.name === "subagent")) {
			warnedSubagents = true;
			report(
				ctx,
				"spechub: pi-subagents is not loaded, so the test-writer, task-executor, task-checker and frontend-verifier agents cannot run. Install it with `pi install npm:pi-subagents`.",
				"warning",
			);
		}

		if (event.reason === "startup" && !isProject(ctx.cwd)) {
			report(ctx, "spechub: no project config found. Run /spechub:setup to set up.");
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const sections = event.systemPromptOptions.sections;

		if (isProject(ctx.cwd)) {
			const orchestrator = readText(orchestratorFile);
			if (orchestrator) sections["spechub-orchestrator"] = orchestrator;
			else report(ctx, `spechub: could not read ${orchestratorFile}`, "warning");
		}

		if (!readSettings().writingStyle) return;
		const style = readText(styleFile);
		if (!style) return;
		sections["spechub-writing-style"] = stripFrontmatter(style);
		const reminder = extractWritingReminder(style);
		if (!reminder) return;
		return { message: { customType: "spechub-writing-style-reminder", content: reminder, display: false } };
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed") return;
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null) return;
		const key = sessionKey(ctx);
		if (!key) return;

		const dir = pressureStateDir();
		if (fs.existsSync(path.join(dir, `${key}.quiet`))) return;
		const lastFile = path.join(dir, `${key}.last`);
		const lastText = readText(lastFile)?.trim();
		const lastRung = lastText && /^\d+$/.test(lastText) ? Number.parseInt(lastText, 10) : undefined;

		const cfg = readHandoffConfig(readText(path.join(ctx.cwd, "spechub", "project.yaml")));
		const nudge = contextNudge(usage.tokens, usage.contextWindow, cfg, lastRung, process.env.HERDR_ENV === "1");
		if (!nudge) return;

		// Record the rung before speaking. A nudge it cannot remember firing
		// would repeat on every settle.
		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(lastFile, `${nudge.rung}\n`, "utf-8");
		} catch {
			return;
		}
		return {
			entries: [{ type: "custom_message", customType: "spechub-context-pressure", content: nudge.reason, display: true }],
			continue: true,
		};
	});

	pi.on("session_compact", async (_event, ctx) => {
		// The compaction threw the old context away, so the ladder starts over.
		const key = sessionKey(ctx);
		if (key) {
			for (const suffix of [".last", ".quiet"]) {
				try {
					fs.rmSync(path.join(pressureStateDir(), key + suffix), { force: true });
				} catch {
					// Unremovable: the handoff below still has to load.
				}
			}
		}

		const handoff = consumeHandoff(ctx.cwd);
		if (handoff) {
			pi.sendMessage({ customType: "spechub-handoff", content: handoff, display: true }, { deliverAs: "nextTurn" });
		}
	});

	// /spechub map <args> and /spechub:map <args> both run SpecHub's own map
	// skill, matching the /spechub:map names Claude Code shows.
	const skills = listSkills();
	const runSkill = (name: string, args: string, ctx: ExtensionContext): void => {
		const file = skills.get(name);
		const message = file && skillInvocation(name, file, args);
		if (!message) {
			report(ctx, `spechub: no skill named "${name}". Skills: ${[...skills.keys()].join(", ")}`, "warning");
			return;
		}
		if (ctx.isIdle()) pi.sendUserMessage(message);
		else pi.sendUserMessage(message, { deliverAs: "followUp" });
	};

	pi.registerCommand("spechub", {
		description: "Run a SpecHub skill: /spechub <skill> [args], e.g. /spechub map",
		handler: async (args, ctx) => {
			const [name = "", ...rest] = args.trim().split(/\s+/);
			if (!name) {
				report(ctx, `spechub: usage is /spechub <skill> [args]. Skills: ${[...skills.keys()].join(", ")}`);
				return;
			}
			runSkill(name, rest.join(" "), ctx);
		},
	});

	for (const name of skills.keys()) {
		pi.registerCommand(`spechub:${name}`, {
			description: `Run the SpecHub ${name} skill`,
			handler: async (args, ctx) => runSkill(name, args, ctx),
		});
	}

	pi.registerCommand("spechub-writing-style", {
		description: "Turn the SpecHub writing style on or off for every pi session (on | off)",
		handler: async (args, ctx) => {
			const choice = args.trim().toLowerCase();
			const settings = readSettings();
			if (choice === "on" || choice === "off") {
				settings.writingStyle = choice === "on";
				writeSettings(settings);
			} else if (choice) {
				report(ctx, "spechub: usage is /spechub-writing-style on|off", "warning");
				return;
			}
			report(ctx, `spechub: writing style is ${settings.writingStyle ? "on" : "off"} (${settingsFile()}).`);
		},
	});
}
