apply_ghdash() {
  have gh || { say "gh not installed, skipping dashboard"; return 0; }
  gh extension list 2>/dev/null | grep -q gh-dash || gh extension install dlvhdr/gh-dash >/dev/null 2>&1
  mkdir -p "$(dirname "$GHDASH_CFG")"
  ACSTACK_CFG="$CFG" py "$GHDASH_CFG" <<'PY'
import os, sys, yaml
src, dst = os.environ["ACSTACK_CFG"], sys.argv[1]
# `or {}` on the section as well as the file. A bare "gh_dash:" with nothing
# under it, which is what commenting the block out leaves behind, parses to
# None, and every tw.get below then raises AttributeError. apply_ghdash died
# on that with a traceback and wrote no config at all. The keybindings and
# remote lookups below already guard the same way.
tw = ((yaml.safe_load(open(src)) or {}).get("gh_dash") or {}) if os.path.isfile(src) else {}
cfg = yaml.safe_load(open(dst)) or {} if os.path.isfile(dst) else {}
if tw.get("sections"):
    cfg["prSections"] = [{"title": s["title"], "filters": s["filters"]} for s in tw["sections"]]
if tw.get("repo_paths"):
    cfg["repoPaths"] = tw["repo_paths"]
kb = tw.get("keybindings", {}) or {}
# Every other setting reaches this script through cfg_get, which carries its
# own default. This block reads the yaml itself, so a machine with no
# terminal-workspace config used to land here with an empty dict: the prune
# below dropped the review and agent keys, and nothing was written back. D
# and S went silently dead while o, which already defaulted, kept working.
# Defaults here, matching config.example.yaml. An empty string still disables.
review = kb.get("review", "D")
agent_review = kb.get("agent_review", "S")
# "tree diff" is the old name for the review key, kept here so re-applying
# over a config written before the rename drops it rather than leaving two
# bindings on the same key.
MANAGED = ("review (tuicr)", "tree diff", "agent review", "open in browser")
prs = [k for k in (cfg.get("keybindings", {}) or {}).get("prs", [])
       if k.get("name") not in MANAGED]
if review:
    prs.append({"key": review, "name": "review (tuicr)",
                "command": "cd {{.RepoPath}} && tuicr pr {{.PrNumber}}\n"})
if agent_review:
    prs.append({"key": agent_review, "name": "agent review",
                "command": 'cd {{.RepoPath}} && claude "/code-review {{.PrNumber}}"\n'})
kbs = cfg.setdefault("keybindings", {})
# o built into gh-dash opens through $BROWSER, whose output it discards. That
# is enough for a machine with a desktop and nothing at all for one without,
# where the only way to reach a browser is to hand the terminal a link. Take
# the key so acstack-open gets a terminal to draw on. GH_HOST covers
# GitHub Enterprise, whose URLs are the same shape on a different host.
open_key = (tw.get("remote", {}) or {}).get("open_key", "o")
if open_key:
    host = "https://${GH_HOST:-github.com}"
    prs.append({"key": open_key, "name": "open in browser",
                "command": f'acstack-open "{host}/{{{{.RepoName}}}}/pull/{{{{.PrNumber}}}}"\n'})
    issues = [k for k in (cfg.get("keybindings", {}) or {}).get("issues", [])
              if k.get("name") not in MANAGED]
    issues.append({"key": open_key, "name": "open in browser",
                   "command": f'acstack-open "{host}/{{{{.RepoName}}}}/issues/{{{{.IssueNumber}}}}"\n'})
    kbs["issues"] = issues
kbs["prs"] = prs
if tw.get("page_keys", True):
    uni = [k for k in kbs.get("universal", []) if k.get("builtin") not in ("pageUp", "pageDown")]
    uni += [{"key": "pgup", "builtin": "pageUp"}, {"key": "pgdown", "builtin": "pageDown"}]
    kbs["universal"] = uni
yaml.safe_dump(cfg, open(dst, "w"), sort_keys=False, default_flow_style=False, width=200)
print("  gh-dash config written")
PY
}

# Every edit the pi component makes to pi's own files goes through here, and
# so does the record of what it changed. pi's config is JSON, which has no
# comment to mark a managed region with, so ownership lives in $PI_OWNED.
#   pkg <identity>             the configured source pi holds for a package
#   own|disown pkg|file <name> record or forget one thing this setup added
#   owns pkg|file <name>       exit 0 when this setup added it
#   parses <file>              exit 0 when the file is absent or valid JSON
#   merge <file> <slot> <json> claim each dotted key with a value, and release
#                              each one set to null, putting back what it held
#   pin <identity> <prior> <ours>  record a pin apply moved, keeping the first prior
#   pin-get <identity>         the prior and our pin, tab-separated
#   pin-forget <identity>      drop that record
#   md write|strip             the delegation block in pi's context file
