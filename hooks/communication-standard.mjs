import { readFileSync } from 'node:fs';
import { readCommunicationStandard } from './lib/communication-standard.mjs';

try {
  const { hook_event_name: event } = JSON.parse(readFileSync(0, 'utf8'));
  if (event !== 'SessionStart' && event !== 'SubagentStart') {
    throw new Error('Expected SessionStart or SubagentStart');
  }
  const standard = readCommunicationStandard(process.argv[2]);
  console.log(JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: event, additionalContext: standard },
  }));
} catch (error) {
  console.error(`acstack communication standard: ${error.message}`);
  process.exitCode = 1;
}
