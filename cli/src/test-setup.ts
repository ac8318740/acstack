import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate every location ACStack reads or migrates, so no test touches the user's real files.
const home = mkdtempSync(join(tmpdir(), 'acstack-test-'));
process.env.ACSTACK_HOME = join(home, 'acstack');
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.XDG_DATA_HOME = join(home, 'share');
