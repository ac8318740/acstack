// PreToolUse hook for Claude Code and Codex: the large-read guard.
// Reads the hook input on stdin and prints a deny decision, or nothing.
// Any failure allows the call, so the guard can never trap an agent.

import { readFileSync } from 'node:fs';
import { decide, envSaysNotMain, fileLedger } from './lib/read-guard.mjs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  // Subagents and in-process teammates carry agent_id in both harnesses.
  const main = !input.agent_id && !envSaysNotMain();
  const cwd = input.cwd || process.cwd();
  const result = decide({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    cwd,
    main,
    ledger: main ? fileLedger(input.session_id) : undefined,
  });
  if (result.block) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: result.message,
      },
    }));
  }
} catch {
  // Allow.
}
