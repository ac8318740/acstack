import { Command } from 'commander';
import { existsSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { CHANGES_DIR, ARCHIVE_DIR } from '../lib/constants.js';
import { listChanges, inProject, formatDate, ensureDir } from '../lib/utils.js';

export function register(program: Command): void {
  program
    .command('archive')
    .description('Archive a completed change')
    .argument('[name]', 'change name')
    .option('-y, --yes', 'skip confirmation')
    .action(
      inProject((root, name: string | undefined) => {
        // If no name, list changes
        if (!name) {
          const changes = listChanges(root);
          if (changes.length === 0) {
            console.log(chalk.dim('No active changes to archive.'));
            return;
          }
          console.log(chalk.bold('Active changes:'));
          for (const c of changes) {
            console.log(`  ${c}`);
          }
          console.log(chalk.dim('\nRun: acstack archive <name>'));
          return;
        }

        const changeDir = join(root, CHANGES_DIR, name);
        if (!existsSync(changeDir)) {
          console.error(chalk.red(`Change '${name}' not found.`));
          process.exit(1);
        }

        const archiveName = `${formatDate()}-${name}`;
        const archiveDir = join(root, CHANGES_DIR, ARCHIVE_DIR, archiveName);

        ensureDir(join(root, CHANGES_DIR, ARCHIVE_DIR));
        cpSync(changeDir, archiveDir, { recursive: true });
        rmSync(changeDir, { recursive: true });

        console.log(chalk.green(`Archived: ${name}`));
        console.log(`  From: ${CHANGES_DIR}/${name}/`);
        console.log(`  To:   ${CHANGES_DIR}/${ARCHIVE_DIR}/${archiveName}/`);
      })
    );
}
