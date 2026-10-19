Authored design files define the design in the local checkout; GitHub hosts a published copy only if the developer chooses to share it.

- Local files drive the review
    - The Review command and server read the local YAML and supporting Markdown to generate the browser view and Markdown companion
    - Revise these source files when the design changes
    - Local browser review and saved comments work without publishing design files to GitHub
- GitHub hosts a published copy
    - The Project developer can commit and push the generated companion for others to read on GitHub
    - The developer can publish the companion alone or include the authored source files
    - GitHub does not replace the local files read by the review server or automatically receive its saved comments
    - This diagram's publication arrow is separate from using GitHub issues as a map tracker
- Git ignore rules control tracking, not publication
    - Ignore rules exclude matching untracked files from ordinary staging
    - Removing an ignore rule does not stage, commit, or push anything
    - Already tracked files remain tracked even if an ignore rule later matches them
    - New project designs under `.acstack/` stay ignored by default; this public example is tracked separately
