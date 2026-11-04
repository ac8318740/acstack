# Keep project data local under .acstack

ACStack keeps project records under `.acstack/` to exclude feedback and local settings from routine commits. Native Git exceptions let each project choose which parts to share. Existing projects move through an explicit offline migration.

## Consequences

- Setup offers every known part with none selected for tracking
- A clone does not restore ignored records; users must copy them separately or choose to track them
- The root `.gitignore` supplies the default while preserving user rules
- Migration preserves file contents, link meaning, and the Git index
- Old tracked paths become pending deletions; new paths remain ignored unless the user opts them in
- Other checkouts migrate separately after their old agents and review processes stop
