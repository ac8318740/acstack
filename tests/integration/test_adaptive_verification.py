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
        (self.root / ".acstack").mkdir()
        self.project = self.root / ".acstack/project.yaml"
        self.project.write_text("profile: node-typescript\n")

    def cli(self, *args):
        return subprocess.run(
            ["node", str(ROOT / "cli/bin/acstack.js"), "config", *args],
            cwd=self.root,
            env={**os.environ, "HOME": str(self.root),
                 "XDG_CONFIG_HOME": str(self.root / "config")},
            capture_output=True, text=True, timeout=30,
        )

    def test_legacy_booleans_remain_readable_writable_and_unsettable(self):
        for strict, orchestrator in ((True, False), (False, True)):
            with self.subTest(strict=strict, orchestrator=orchestrator):
                self.project.write_text(
                    "# keep this comment\nprofile: node-typescript\nworkflow:\n"
                    f"  tdd:\n    strict: {str(strict).lower()}\n"
                    f"    orchestrator_strict: {str(orchestrator).lower()}\n"
                )
                # An unrelated write must preserve hand-authored legacy values.
                self.assertEqual(self.cli("set", "commands.test", "npm test").returncode, 0)
                for key, value in zip(KEYS, (strict, orchestrator), strict=True):
                    read = self.cli("get", key)
                    self.assertEqual((read.returncode, read.stdout.strip()),
                                     (0, str(value).lower()))
                    written = self.cli("set", key, str(not value).lower())
                    self.assertEqual(written.returncode, 0, written.stderr)
                    read = self.cli("get", key)
                    self.assertEqual((read.returncode, read.stdout.strip()),
                                     (0, str(not value).lower()))
                listed = self.cli("list", "--json")
                self.assertEqual(listed.returncode, 0, listed.stderr)
                entries = {row["key"]: row for row in json.loads(listed.stdout)["project"]}
                for key, value in zip(KEYS, (not strict, not orchestrator), strict=True):
                    self.assertEqual(entries[key], {"key": key, "value": value, "known": True})
                    self.assertEqual(self.cli("unset", key).returncode, 0)
                    self.assertEqual(self.cli("get", key).returncode, 2)
                self.assertIn("# keep this comment", self.project.read_text())
                self.assertEqual(self.cli("get", "commands.test").stdout.strip(), "npm test")

    def test_unset_legacy_keys_do_not_advertise_an_effective_boolean_default(self):
        for key in KEYS:
            with self.subTest(key=key):
                result = self.cli("get", key)
                self.assertEqual(result.returncode, 2)
                self.assertIn("unset", result.stderr.lower())
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
        generated = self.root / "pi/agents/task-executor.md"
        frontmatter = generated.read_text().split("---", 2)[1]
        fields = dict(re.findall(r"^([A-Za-z]+):\s*(.*?)\s*$", frontmatter, re.M))
        self.assertIn("test-conventions", fields.get("skills", "").split(", "))
        self.assertEqual((generated.parent / fields["skillPath"] / "test-conventions/SKILL.md").resolve(),
                         self.root / "skills/test-conventions/SKILL.md")


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdaptiveVerificationTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    # A subtest's id extends its parent; count parent tests for run-all.sh.
    failed = len({test.id().split(" (")[0] for test, _ in result.failures + result.errors})
    print(f"Result: {result.testsRun - failed} passed, {failed} failed")
    raise SystemExit(not result.wasSuccessful())
