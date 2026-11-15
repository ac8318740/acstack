import { Command, Option } from 'commander';
import { createInterface } from 'node:readline/promises';
import { existsSync, realpathSync } from 'node:fs';
import { legacyWarnings, migrateProjectData, migrationQuestions, relinkProject, type MigrateChoices, type MigrateQuestion } from '../lib/project-data.js';

const PROMPTS: Record<MigrateQuestion, string> = {
  decisions: "Move the project folder's decisions/ into this worktree's .acstack/ to commit them?",
  glossary: "Move the project folder's CONTEXT.md into this worktree's .acstack/ to commit it?",
  retired: 'Delete the retired specs/ and domain-map.yaml from the project folder?',
};
import { findProjectRoot, locateProject, orphanWarnings } from '../lib/project.js';
import { fail } from '../lib/utils.js';

function reportStranded(stranded: string[]): void {
  for (const path of stranded) console.error(`${path} still holds .acstack/ changes beyond decisions/ and CONTEXT.md, which ACStack no longer reads. Move what you need, then delete it.`);
}

export function register(program: Command): void {
  const command = program.command('project-data').description("Locate and migrate this repository's ACStack project data");
  command.command('path').description('Print the project folder for this repository, whether or not it exists yet; warn about legacy data')
    .action(() => {
      try {
        for (const line of legacyWarnings()) console.error(`acstack: ${line}`);
        const location = locateProject();
        if (!location) throw new Error('Not in a Git repository; ACStack keys project data by repository.');
        for (const line of orphanWarnings(location)) console.error(`acstack: ${line}`);
        findProjectRoot();
        console.log(existsSync(location.entry) ? realpathSync(location.entry) : location.entry);
      } catch (error) { fail((error as Error).message); }
    });
  command.command('migrate').description('Move legacy global files and project data into ~/.acstack, keeping decisions/ and CONTEXT.md in the repository; stop review servers and agents and back up first')
    .addOption(new Option('--decisions <choice>', "move the project folder's decisions/ into this worktree's .acstack/, or keep it").choices(['move', 'keep']))
    .addOption(new Option('--glossary <choice>', "move the project folder's CONTEXT.md into this worktree's .acstack/, or keep it").choices(['move', 'keep']))
    .addOption(new Option('--retired <choice>', 'delete the retired specs/ and domain-map.yaml, or keep them').choices(['delete', 'keep']))
    .action(async (options: MigrateChoices) => {
      try {
        const choices = { ...options };
        const missing = migrationQuestions(process.cwd()).filter(question => !choices[question]);
        if (missing.length && process.stdin.isTTY) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            for (const question of missing) {
              const yes = /^y/i.test(await rl.question(`${PROMPTS[question]} [y/N] `));
              if (question === 'retired') choices.retired = yes ? 'delete' : 'keep';
              else choices[question] = yes ? 'move' : 'keep';
            }
          } finally { rl.close(); }
        } else if (missing.includes('retired')) {
          console.error('Retired specs/ or domain-map.yaml remain; pass --retired delete to remove them.');
        }
        const result = migrateProjectData(process.cwd(), choices);
        for (const path of result.moved) console.log(`Moved ${path}`);
        for (const path of result.deleted) console.log(`Deleted ${path}`);
        reportStranded(result.stranded);
      } catch (error) { fail((error as Error).message); }
    });
  command.command('relink <entry>').description('Give the named project entry, left by this repository before it moved, this repository\'s key')
    .action((entry: string) => {
      try {
        const result = relinkProject(process.cwd(), entry);
        console.log(`Relinked ${result.from} as ${result.to}`);
      } catch (error) { fail((error as Error).message); }
    });
}
