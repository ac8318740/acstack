import { Command } from 'commander';
import { ensureProjectGitignore, migrateProjectData } from '../lib/project-data.js';
import { findProjectRoot } from '../lib/project.js';
import { fail } from '../lib/utils.js';

export function register(program: Command): void {
  const command = program.command('project-data').description('Keep project data local or explicitly migrate legacy data');
  command.command('ensure').description('Reconcile the root Git ignore policy when .acstack exists, without requiring project.yaml')
    .action(() => {
      try { ensureProjectGitignore(findProjectRoot() ?? process.cwd()); }
      catch (error) { fail((error as Error).message); }
    });
  command.command('migrate').description('Migrate legacy data in the current root; stop review servers and agents and back up first')
    .action(() => {
      try {
        const result = migrateProjectData(process.cwd());
        for (const path of result.moved) console.log(`Moved project data to ${path}`);
      } catch (error) { fail((error as Error).message); }
    });
}
