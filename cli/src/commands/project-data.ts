import { Command } from 'commander';
import { existsSync, realpathSync } from 'node:fs';
import { legacyWarnings, migrateProjectData, relinkProject, setProjectMode } from '../lib/project-data.js';
import { findProjectRoot, locateProject, orphanWarnings } from '../lib/project.js';
import { fail } from '../lib/utils.js';

function reportStranded(stranded: string[]): void {
  for (const path of stranded) console.error(`${path} still holds its own .acstack/ changes, which ACStack no longer reads. Move what you need, then delete it.`);
}

export function register(program: Command): void {
  const command = program.command('project-data').description("Locate, migrate, and choose the mode of this repository's ACStack project data");
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
  command.command('migrate').description('Move legacy global files and this repository\'s .acstack/ into ~/.acstack; stop review servers and agents and back up first')
    .action(() => {
      try {
        const result = migrateProjectData(process.cwd());
        for (const path of result.moved) console.log(`Moved project data to ${path}`);
        reportStranded(result.stranded);
      } catch (error) { fail((error as Error).message); }
    });
  command.command('mode <mode>').description('tracked: move the project folder into the main checkout\'s .acstack/ for committing; global: move it back')
    .action((mode: string) => {
      try {
        if (mode !== 'tracked' && mode !== 'global') throw new Error('Mode must be tracked or global.');
        reportStranded(setProjectMode(process.cwd(), mode).stranded);
        console.log(mode === 'tracked' ? 'Project data is now in .acstack/ of the main checkout. Commit it to share it.' : 'Project data is now in the project folder. Commit the removal of .acstack/ to stop tracking it.');
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
