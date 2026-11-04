## Layout of the global root

```text
~/.acstack/                         (or $ACSTACK_HOME)
├── config.json                     was ~/.config/acstack/config.json
├── opener.token                    was ~/.config/acstack/opener.token
├── terminal-workspace.yaml         and the other terminal-workspace files
├── cache/mermaid.min.js            was ~/.local/share/acstack/
├── ac-teams/                       unchanged; owned by ac-teams
└── projects/
    ├── shop-3f9a2c/                global mode: a real folder
    │   ├── project.json            records the shared git folder
    │   ├── project.yaml
    │   ├── specs/  maps/  designs/  design-reviews/  decisions/ ...
    └── acstack-91c0d4 -> /home/dev/projects/acstack/.acstack   tracked mode
```

Inside a project folder, every part keeps the name it has under today's `.acstack/`, so skills change the folder they point at, not the parts inside it.
