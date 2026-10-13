/**
 * ACStack on pi.
 *
 * The pi port of the Claude Code hooks in hooks/. Claude Code and Codex never
 * load this file, and nothing in hooks/ depends on it.
 *
 *   session_start        symlink the CLI, warn once if pi-subagents is
 *                        missing, and print the setup reminder outside a
 *                        acstack project            (hooks/session-start.sh)
 *   before_agent_start   list ACStack's skills in the system prompt in every
 *                        session, and add orchestrator/AGENTS.md in a
 *                        acstack project            (hooks/session-start.sh)
 *                        add the writing style and its per-turn reminder
 *                        from the SSOT style file   (hooks/ac-writing-style-reminder.sh)
 *   agent_before_settle  nudge with a continuity-versus-freshness checkpoint
 *                        as context fills          (hooks/context-pressure.sh)
 *   session_compact      re-inject acstack/HANDOFF.md after a compaction, and
 *                        restart the nudge ladder   (hooks/session-start-handoff.sh,
 *                                                    hooks/context-pressure.sh)
 *
 * It also registers /acstack <skill>, a /acstack:<skill> command per skill,
 * and /acstack-writing-style for the bundled/default/custom style choice.
 * The first two forms are the only way a user runs an ACStack skill on pi:
 * package.json lists no skills, so pi adds no /skill:<name> commands for them.
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

const settingsFile = (): string => path.join(agentDir(), "acstack.json");

type WritingStyleMode = "default" | "off" | "custom";
type WritingStyleSettings = { mode?: WritingStyleMode; path?: string };
type AcstackSettings = { writingStyle?: boolean | WritingStyleSettings };

function readText(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return undefined;
	}
}

function readSettings(): AcstackSettings {
	try {
		const parsed = JSON.parse(readText(settingsFile()) ?? "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeSettings(settings: AcstackSettings): void {
	fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
	fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function writingStyleSettings(settings: AcstackSettings = readSettings()): WritingStyleSettings {
	const value = settings.writingStyle;
	if (value === false) return { mode: "off" };
	if (value === true || value === undefined) return { mode: "default" };
	if (value && typeof value === "object") return { mode: value.mode ?? "default", path: value.path };
	return { mode: "default" };
}

function expandUserPath(file: string, cwd = process.cwd()): string {
	if (file === "~") return os.homedir();
	if (file.startsWith(`~${path.sep}`)) return path.join(os.homedir(), file.slice(2));
	return path.isAbsolute(file) ? file : path.resolve(cwd, file);
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
			report(ctx, `acstack: linked ${label} at ${link} -> ${src}`);
		} catch {
			report(ctx, `acstack: failed to create symlink at ${link} – see ${troubleshoot} (section: command not found).`, "warning");
		}
		return;
	}

	if (current === undefined) {
		report(ctx, `acstack: ${link} exists but is not a symlink – not overwriting. See ${troubleshoot} (section: command not found).`, "warning");
		return;
	}

	if (current === src) return;
	try {
		const tmp = `${link}.acstack-${process.pid}`;
		fs.symlinkSync(src, tmp);
		fs.renameSync(tmp, link);
		// A repoint is routine after every upgrade, so it stays off the UI.
		process.stderr.write(`acstack: updated ${label} at ${link} -> ${src}\n`);
	} catch {
		report(ctx, `acstack: failed to update stale symlink at ${link} (was: ${current}) – see ${troubleshoot} (section: stale cache).`, "warning");
	}
}

/** The first executable `acstack` on PATH, like `command -v acstack`. */
function acstackOnPath(): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, "acstack");
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
 * Every skill and agent calls the CLI as ~/.claude/acstack/bin/acstack, so the
 * agent path keeps its Claude-flavoured location on pi too. With both Claude
 * Code and pi installed, each one points the symlink at its own copy on every
 * session start, so it flips between the two caches. Both copies are a
 * released CLI, so either target works.
 */
function linkClis(ctx: ExtensionContext): void {
	const wrapper = path.join(packageRoot, "cli", "bin", "acstack.js");
	const dist = path.join(packageRoot, "cli", "dist", "index.js");
	if (!fs.existsSync(wrapper)) return;
	if (!fs.existsSync(dist)) {
		report(ctx, `acstack: CLI is missing its built output (${dist}) – see ${troubleshoot} (section: ERR_MODULE_NOT_FOUND).`, "error");
		return;
	}

	const home = os.homedir();
	linkCli(ctx, wrapper, path.join(home, ".claude", "acstack", "bin", "acstack"), "agent CLI");

	// Defer to an acstack on PATH that someone else installed. The agent path
	// above is absolute, so it is never affected.
	const humanLink = path.join(home, ".local", "bin", "acstack");
	const onPath = acstackOnPath();
	// The shell hook says so on every session. pi shows each report as a
	// notification, so this stays silent instead.
	if (!onPath || onPath === humanLink || realpathOrSelf(onPath) === realpathOrSelf(humanLink)) {
		linkCli(ctx, wrapper, humanLink, "human CLI");
	}

	if (process.platform === "linux" || process.platform === "darwin") {
		const vmFreePort = path.join(packageRoot, "assets", "playwriter-bridge", "vm-free-port.sh");
		if (fs.existsSync(vmFreePort)) {
			linkCli(ctx, vmFreePort, path.join(home, ".claude", "acstack", "bin", "vm-free-port.sh"), "vm-free-port.sh");
		}
	}
}

// --------------------------------------------------------------------------
// Writing style
// --------------------------------------------------------------------------

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
const LARGE_CONTEXT_WINDOW = 1000000;

const AGENCY =
	"The call is yours. If you have a strong view either way, act on it " +
	"without asking. Either keep continuity in this session, or choose " +
	"freshness with /acstack:handoff. Ask the user with the host's question " +
	"tool if you don't know which route would make the work go better.";

const STANDING_AGREEMENT =
	"If you are partway through a long run of tasks and the user already " +
	"agreed to a handoff earlier in this session, including in a handoff " +
	"or compaction summary you resumed from, use /acstack:handoff without " +
	"asking again.";

const DECIDE_TAIL =
	`${AGENCY} ${STANDING_AGREEMENT}` +
	" If you do ask and the user chooses continuity, drop it for now" +
	" and revisit freshness once the current run of work wraps up.";

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
 * The workflow.handoff keys from acstack/project.yaml. A port of read_config
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
	_inHerdr: boolean,
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

	const used = tokens.toLocaleString("en-US");
	const limit = rung.toLocaleString("en-US");
	let continuity = "Continuity: if your working context is useful, keep going in this same session";
	if (window >= LARGE_CONTEXT_WINDOW) continuity += " and rely on billion-context";
	continuity += ", with ACP compression as an in-place option if the host offers it.";
	const freshness = "Freshness: if a fresh context window or an independent read would help more, use /acstack:handoff.";
	const head =
		rung >= severeAt
			? `Context check (urgent): this session has used about ${used} tokens, ` +
				`past the ${limit} severe mark, so it is close to the wall. Treat high ` +
				`context as a continuity-versus-freshness checkpoint. ${continuity} ` +
				`${freshness} If you ask the user, say plainly that context is nearly ` +
				"gone so they can decide quickly."
			: `Context check: this session has used about ${used} tokens, past the ` +
				`${limit} mark. Treat high context as a continuity-versus-freshness ` +
				`checkpoint. ${continuity} ${freshness}`;
	return { rung, reason: `${head} ${DECIDE_TAIL}` };
}

/**
 * Ladder state shares its directory and file names with
 * hooks/context-pressure.sh. The handoff skill writes <session id>.quiet
 * there once the work is handed over.
 */
function pressureStateDir(): string {
	return process.env.ACSTACK_CONTEXT_PRESSURE_DIR || path.join(process.env.TMPDIR || "/tmp", "acstack-context-pressure");
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
	"The session was just compacted. The following ACStack handoff captures " +
	"load-bearing work state the summary may have compressed. Treat it as " +
	"authoritative for what to do next.\n\n" +
	'Resume now: when the user\'s next message is "continue" (or any short ' +
	"nudge), pick up the work immediately from the Next action below - do not " +
	"wait for further instruction. If anything in this handoff or the " +
	"compaction summary is ambiguous or underspecified, ask the user " +
	"to resolve it before acting rather than guessing. Ask liberally: a " +
	"wrong assumption taken after compaction is expensive to unwind.\n\n";

/**
 * Consume acstack/HANDOFF.md the way hooks/session-start-handoff.sh does:
 * only a file carrying the acstack_handoff marker, moved into a per-map
 * archive so it is never injected twice. Returns the text to inject.
 */
export function consumeHandoff(cwd: string, now: Date = new Date()): string | undefined {
	const active = path.join(cwd, "acstack", "HANDOFF.md");
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
	if (!("acstack_handoff" in meta) || !body.trim()) return undefined;

	let map = (meta.map || meta.change || "ad-hoc").replace(/[^A-Za-z0-9._-]/g, "-");
	if (!map.replace(/^\.+|\.+$/g, "")) map = "ad-hoc";
	let stamp = (meta.created || "").replace(/[^A-Za-z0-9._-]/g, "-");
	if (!stamp) stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");

	const changeDir = path.join(cwd, "acstack", "changes", map);
	const archiveDir =
		map !== "ad-hoc" && fs.existsSync(changeDir)
			? path.join(changeDir, "handoffs")
			: path.join(cwd, "acstack", "handoffs", map);
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

interface SkillInfo {
	file: string;
	description: string;
	/** disable-model-invocation: true – runs only when the user asks for it. */
	userOnly: boolean;
}

/** One frontmatter value: every SKILL.md keeps its fields on one line. */
function frontmatterField(text: string, key: string): string | undefined {
	const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
	const raw = new RegExp(`^${key}:[ \t]*(.*)$`, "m").exec(frontmatter)?.[1].trim();
	if (raw === undefined) return undefined;
	if (raw.startsWith('"') && raw.endsWith('"')) {
		try {
			return JSON.parse(raw);
		} catch {
			return raw.slice(1, -1);
		}
	}
	if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
	return raw;
}

/** This package's skills, by name, from skills/<dir>/SKILL.md. */
export function listSkills(root: string = packageRoot): Map<string, SkillInfo> {
	const skills = new Map<string, SkillInfo>();
	const dir = path.join(root, "skills");
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return skills;
	}
	for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
		const file = path.join(dir, entry.name, "SKILL.md");
		const text = readText(file) ?? "";
		const name = frontmatterField(text, "name");
		if (!name) continue;
		skills.set(name, {
			file,
			description: frontmatterField(text, "description") ?? "",
			userOnly: frontmatterField(text, "disable-model-invocation") === "true",
		});
	}
	return skills;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * The skills section of the system prompt. ACStack's skills are not pi skills,
 * because pi would turn each one into a /skill:<name> command, so this lists
 * them the way pi's formatSkillsForPrompt lists its own. Like pi, it leaves
 * out a skill only the user may run.
 */
export function skillsSection(skills: Map<string, SkillInfo>): string | undefined {
	const visible = [...skills].filter(([, skill]) => !skill.userOnly);
	if (visible.length === 0) return undefined;
	const lines = [
		"The following ACStack skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"When you tell the user to run an ACStack skill, write /acstack:<name>, never /skill:<name>.",
		"",
		"<available_skills>",
	];
	for (const [name, skill] of visible) {
		lines.push(
			"  <skill>",
			`    <name>${escapeXml(name)}</name>`,
			`    <description>${escapeXml(skill.description)}</description>`,
			`    <location>${escapeXml(skill.file)}</location>`,
			"  </skill>",
		);
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

/**
 * The user message for one ACStack skill, in the same shape pi's own
 * /skill:<name> expansion produces. Built from this package's file, so a
 * generic name such as map or commit that another package's skill took
 * first still runs the ACStack skill.
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

export default function acstack(pi: ExtensionAPI): void {
	// A background subagent loads every ambient extension. The orchestrator
	// prompt and the nudges belong to the lead session, never to a subagent.
	if (process.env[SUBAGENT_CHILD_ENV] === "1" || process.env[HERDR_BRIDGE_CHILD_ENV] === "1") return;

	const orchestratorFile = path.join(packageRoot, "orchestrator", "AGENTS.md");
	const styleFile = path.join(packageRoot, "output-styles", "ac-writing-style.md");
	const isProject = (cwd: string) => fs.existsSync(path.join(cwd, "acstack", "project.yaml"));
	let warnedSubagents = false;

	pi.on("session_start", async (event, ctx) => {
		linkClis(ctx);

		if (!warnedSubagents && !pi.getAllTools().some((tool) => tool.name === "subagent")) {
			warnedSubagents = true;
			report(
				ctx,
				"acstack: pi-subagents is not loaded, so the test-writer, task-executor, task-checker and frontend-verifier agents cannot run. Install it with `pi install npm:pi-subagents`.",
				"warning",
			);
		}

		if (event.reason === "startup" && !isProject(ctx.cwd)) {
			report(ctx, "acstack: no project config found. Run /acstack:setup to set up.");
		}
	});

	// /acstack map <args> and /acstack:map <args> both run ACStack's own map
	// skill, matching the /acstack:map names Claude Code shows.
	const skills = listSkills();
	const skillsPrompt = skillsSection(skills);

	pi.on("before_agent_start", async (event, ctx) => {
		const sections = event.systemPromptOptions.sections;

		// Every session, like the plugin's skills on Claude Code.
		if (skillsPrompt) sections["acstack-skills"] = skillsPrompt;

		if (isProject(ctx.cwd)) {
			const orchestrator = readText(orchestratorFile);
			if (orchestrator) sections["acstack-orchestrator"] = orchestrator;
			else report(ctx, `acstack: could not read ${orchestratorFile}`, "warning");
		}

		const styleCfg = writingStyleSettings();
		if (styleCfg.mode === "off") return;
		const resolvedStyleFile = styleCfg.mode === "custom" && styleCfg.path ? expandUserPath(styleCfg.path) : styleFile;
		const style = readText(resolvedStyleFile);
		if (!style) {
			report(ctx, `acstack: could not read writing style at ${resolvedStyleFile}`, "warning");
			return;
		}
		sections["acstack-writing-style"] = stripFrontmatter(style);
		if (event.messageType !== "user") return;
		const reminder = extractWritingReminder(style);
		if (!reminder) return;
		return { message: { customType: "acstack-writing-style-reminder", content: reminder, display: false } };
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

		const cfg = readHandoffConfig(readText(path.join(ctx.cwd, "acstack", "project.yaml")));
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
			entries: [{ type: "custom_message", customType: "acstack-context-pressure", content: nudge.reason, display: true }],
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
			pi.sendMessage({ customType: "acstack-handoff", content: handoff, display: true }, { deliverAs: "nextTurn" });
		}
	});

	const runSkill = (name: string, args: string, ctx: ExtensionContext): void => {
		const file = skills.get(name)?.file;
		const message = file && skillInvocation(name, file, args);
		if (!message) {
			report(ctx, `acstack: no skill named "${name}". Skills: ${[...skills.keys()].join(", ")}`, "warning");
			return;
		}
		if (ctx.isIdle()) pi.sendUserMessage(message);
		else pi.sendUserMessage(message, { deliverAs: "followUp" });
	};

	pi.registerCommand("acstack-writing-style", {
		description: "Configure ACStack writing style injection: default | off | custom <path>",
		handler: async (args, ctx) => {
			const [choice = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const settings = readSettings();
			const current = writingStyleSettings(settings);
			if (!choice || choice === "show") {
				report(ctx, `acstack: writing style is ${current.mode}${current.path ? ` (${current.path})` : ""} (${settingsFile()}).`);
				return;
			}
			if (choice === "default") {
				settings.writingStyle = { mode: "default" };
				writeSettings(settings);
				report(ctx, `acstack: writing style is default (${settingsFile()}).`);
				return;
			}
			if (choice === "off") {
				settings.writingStyle = { mode: "off" };
				writeSettings(settings);
				report(ctx, `acstack: writing style is off (${settingsFile()}).`);
				return;
			}
			if (choice === "custom") {
				const customPath = rest.join(" ").trim();
				if (!customPath) {
					report(ctx, "acstack: usage is /acstack-writing-style custom <path>", "warning");
					return;
				}
				const resolvedPath = expandUserPath(customPath, ctx.cwd);
				settings.writingStyle = { mode: "custom", path: resolvedPath };
				writeSettings(settings);
				report(ctx, `acstack: writing style is custom (${resolvedPath}) (${settingsFile()}).`);
				return;
			}
			report(ctx, "acstack: usage is /acstack-writing-style [show|default|off|custom <path>]", "warning");
		},
	});

	pi.registerCommand("acstack", {
		description: "Run an ACStack skill: /acstack <skill> [args], e.g. /acstack map",
		handler: async (args, ctx) => {
			const [name = "", ...rest] = args.trim().split(/\s+/);
			if (!name) {
				report(ctx, `acstack: usage is /acstack <skill> [args]. Skills: ${[...skills.keys()].join(", ")}`);
				return;
			}
			runSkill(name, rest.join(" "), ctx);
		},
	});

	for (const name of skills.keys()) {
		pi.registerCommand(`acstack:${name}`, {
			description: `Run the ACStack ${name} skill`,
			handler: async (args, ctx) => runSkill(name, args, ctx),
		});
	}
}
