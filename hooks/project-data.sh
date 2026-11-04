#!/usr/bin/env bash
# Source from host hooks before reading config or writing project data.

# Print the project folder for the current repository. Fails outside Git, or
# when the CLI names a fix (legacy data, orphaned entry, conflicting modes);
# that message and any legacy-data warning reach the user on stderr.
acstack_project_folder() {
  "$1" project-data path
}
