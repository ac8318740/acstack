"""Observable config compatibility, setup questions, and pi skill binding."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ("workflow.tdd.strict", "workflow.tdd.orchestrator_strict")


class AdaptiveVerificationTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="acstack-verification-")
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        # Project data lives in the global project folder under the test's ACSTACK_HOME.
        folder = Path(self.cli_raw("project-data", "path").stdout.strip())
        folder.mkdir(parents=True)
        self.project = folder / "project.yaml"
        self.project.write_text("profile: node-typescript\n")

    def cli_raw(self, *args, check=True):
        return subprocess.run(
            ["node", str(ROOT / "cli/bin/acstack.js"), *args],
            cwd=self.root,
            env={**os.environ, "HOME": str(self.root),
                 "ACSTACK_HOME": str(self.root / "acstack-home"),
                 "XDG_CONFIG_HOME": str(self.root / "config")},
            capture_output=True, text=True, timeout=30, check=check,
        )

    def cli(self, *args):
        return self.cli_raw("config", *args, check=False)

    def test_removed_legacy_booleans_survive_unrelated_writes(self):
        for strict, orchestrator in ((True, False), (False, True)):
            with self.subTest(strict=strict, orchestrator=orchestrator):
                legacy = (f"  tdd:\n    strict: {str(strict).lower()}\n"
                          f"    orchestrator_strict: {str(orchestrator).lower()}\n")
                self.project.write_text(
                    "# keep this comment\nprofile: node-typescript\nworkflow:\n" + legacy)
                # The keys are gone from the schema, but an unrelated write must keep hand-authored values.
                self.assertEqual(self.cli("set", "commands.test", "npm test").returncode, 0)
                self.assertIn("# keep this comment", self.project.read_text())
                self.assertIn(legacy, self.project.read_text())
                self.assertEqual(self.cli("get", "commands.test").stdout.strip(), "npm test")
                for key in KEYS:
                    for args in (("get", key), ("set", key, "true"), ("unset", key)):
                        self.assertNotEqual(self.cli(*args).returncode, 0, args)

    def test_removed_legacy_keys_do_not_advertise_an_effective_boolean_default(self):
        for key in KEYS:
            with self.subTest(key=key):
                result = self.cli("get", key)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unknown config key", result.stderr.lower())
                self.assertNotRegex(
                    result.stderr.lower(), r"default\s+(?:is\s+|[:=]\s*)?(?:true|false)\b"
                )

    def test_first_run_does_not_offer_legacy_pipeline_switches(self):
        first_run = (ROOT / "skills/setup/first-run.md").read_text()
        menus = [json.loads(block) for block in re.findall(r"```json\s*\n(.*?)```", first_run, re.S)]
        options = [option for menu in menus for question in menu.get("questions", [])
                   for option in question.get("options", [])]
        # These are the actual setup questions, not a second invented menu.
        obsolete = [option for option in options if re.search(
            r"TDD strictness|orchestrator|all three phases", json.dumps(option), re.I)]
        self.assertEqual(obsolete, [], "New setup must not offer the deprecated pipeline switches")

    def test_pr_verification_is_scoped_and_ci_remains_a_merge_gate(self):
        policy = (ROOT / "orchestrator/AGENTS.md").read_text()
        verification = policy.split("## Build verification (mandatory)", 1)[1].split("\n---", 1)[0]
        self.assertIn("Use focused local checks by default", verification)
        self.assertIn("A configured command is not a requirement to run its entire suite", verification)
        self.assertIn("Run the full suite locally only when", verification)
        self.assertIn("Required CI checks must pass before merge, not before opening a PR", verification)
        self.assertIn("Report which checks passed locally, which are deferred to CI", verification)
        self.assertNotIn("Run the configured full test suite; all tests must pass", policy)

    def test_generated_pi_executor_loads_test_conventions(self):
        # Run the shipped generator in a fixture tree, never rewrite committed output.
        (self.root / "scripts").mkdir()
        shutil.copytree(ROOT / "agents", self.root / "agents")
        shutil.copytree(ROOT / "skills", self.root / "skills")
        shutil.copytree(ROOT / "hooks", self.root / "hooks")
        shutil.copytree(ROOT / "output-styles", self.root / "output-styles")
        script = self.root / "scripts/gen-pi-agents.mjs"
        shutil.copyfile(ROOT / "scripts/gen-pi-agents.mjs", script)
        result = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        generated = self.root / "pi/agents/frontend-verifier.md"
        frontmatter = generated.read_text().split("---", 2)[1]
        fields = dict(re.findall(r"^([A-Za-z]+):\s*(.*?)\s*$", frontmatter, re.M))
        self.assertIn("browser-verify", fields.get("skills", "").split(", "))
        self.assertEqual((generated.parent / fields["skillPath"] / "browser-verify/SKILL.md").resolve(),
                         self.root / "skills/browser-verify/SKILL.md")


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdaptiveVerificationTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    # A subtest's id extends its parent; count parent tests for run-all.sh.
    failed = len({test.id().split(" (")[0] for test, _ in result.failures + result.errors})
    print(f"Result: {result.testsRun - failed} passed, {failed} failed")
    raise SystemExit(not result.wasSuccessful())
