#!/usr/bin/env node
// Record the host contract and inject failures; production owns the Git policy.
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.argv.slice(2).join(' ') !== 'project-data ensure') process.exit(64);
if (process.env.ACSTACK_ENSURE_LOG) fs.appendFileSync(process.env.ACSTACK_ENSURE_LOG, `${process.cwd()}\n`);
if (process.env.ACSTACK_ENSURE_FAIL === '1') process.exit(1);
if (!process.env.ACSTACK_REAL_CLI) throw new Error('ACSTACK_REAL_CLI must name the built production CLI');
const result = spawnSync(process.execPath, [process.env.ACSTACK_REAL_CLI, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
