"""Exercise the shipped hook and generators in an isolated plugin tree."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parents[2]
START = "<!-- acstack:communication:start -->"
END = "<!-- acstack:communication:end -->"


class CommunicationStandardTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="acstack communication ")
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name) / "plugin with spaces"
        self.root.mkdir()
        for directory in ("hooks", "scripts", "agents", "skills", "output-styles"):
            shutil.copytree(ROOT / directory, self.root / directory)
        self.outside = Path(self.work.name) / "outside project"
        self.outside.mkdir()
        self.style = self.root / "output-styles/ac-writing-style.md"
        self.standard = self.style.read_text().split(START + "\n")[1].split(END)[0].strip()

    def run_generator(self, host):
        return subprocess.run(
            ["node", str(self.root / f"scripts/gen-{host}-agents.mjs")],
            cwd=self.outside, capture_output=True, text=True, timeout=30,
        )

    def test_canonical_mutation_reaches_every_parsed_child(self):
        extra = '\n\nFixture guidance: "quoted", \\paths, """triples""", and a\ttab\n'
        expected = self.standard + extra.rstrip()
        self.style.write_text(self.style.read_text().replace(self.standard, expected))
        for host in ("codex", "pi"):
            result = self.run_generator(host)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = self.root / ("agents/codex" if host == "codex" else "pi/agents")
            files = sorted(output.glob("*.toml" if host == "codex" else "*.md"))
            self.assertEqual(len(files), 4)
            for file in files:
                with self.subTest(host=host, agent=file.stem):
                    source = (self.root / "agents" / (file.stem + ".md")).read_text()
                    original = source.split("---", 2)[2].strip()
                    if host == "codex":
                        fields = tomllib.loads(file.read_text())
                        self.assertEqual(set(fields), {"name", "description", "developer_instructions"})
                        body = fields["developer_instructions"]
                    else:
                        _, frontmatter, body = file.read_text().split("---", 2)
                        fields = dict(re.findall(r"^([A-Za-z]+):\s*(.*?)\s*$", frontmatter, re.M))
                        self.assertEqual(fields["systemPromptMode"], "append")
                        self.assertEqual(fields["inheritProjectContext"], "true")
                        self.assertEqual(fields["inheritSkills"], "true")
                        self.assertEqual(fields["tools"], "read, grep, find, ls, bash, edit, write")
                        if file.stem in ("task-executor", "test-writer"):
                            self.assertIn("test-conventions", fields["skills"])
                            self.assertEqual(fields["skillPath"], "../../skills")
                    self.assertIn(original, body)
                    self.assertIn(expected, body)

    def test_crlf_canonical_reaches_parsed_generated_children(self):
        self.style.write_bytes(self.style.read_bytes().replace(b"\n", b"\r\n"))
        for host in ("codex", "pi"):
            with self.subTest(host=host):
                result = self.run_generator(host)
                self.assertEqual(result.returncode, 0, result.stderr)
                output = self.root / ("agents/codex" if host == "codex" else "pi/agents")
                files = sorted(output.glob("*.toml" if host == "codex" else "*.md"))
                self.assertEqual(len(files), 4)
                for file in files:
                    body = (tomllib.loads(file.read_text())["developer_instructions"]
                            if host == "codex" else file.read_text().split("---", 2)[2])
                    self.assertIn(self.standard, body)

    def test_hook_through_symlink_with_lf_and_crlf_canonical(self):
        linked = Path(self.work.name) / "symlinked plugin"
        linked.symlink_to(self.root, target_is_directory=True)
        canonical = self.style.read_text()
        for crlf in (False, True):
            self.style.write_bytes(canonical.replace("\n", "\r\n" if crlf else "\n").encode())
            for event in ("SessionStart", "SubagentStart"):
                for fallback in (False, True):
                    with self.subTest(crlf=crlf, event=event, fallback=fallback):
                        env = {**os.environ, "HOME": str(self.outside)}
                        env.pop("CLAUDE_PLUGIN_ROOT", None)
                        if not fallback:
                            env["CLAUDE_PLUGIN_ROOT"] = str(linked)
                        result = subprocess.run(
                            ["bash", str(linked / "hooks/communication-standard.sh")],
                            input=json.dumps({"hook_event_name": event}),
                            cwd=self.outside, env=env, capture_output=True, text=True, timeout=30,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertNotEqual(result.stdout, "", "Hook must emit context through a symlink")
                        context = json.loads(result.stdout)["hookSpecificOutput"]
                        self.assertEqual(context["hookEventName"], event)
                        self.assertEqual(context["additionalContext"], self.standard)

    def test_invalid_standard_preserves_previous_outputs(self):
        valid = self.style.read_text()
        invalid = ("", valid.replace(END, ""), valid.replace(START, ""),
                   END + "\n" + START, START + "\n\n" + END,
                   valid + "\n" + START + "\nagain\n" + END)
        for host in ("codex", "pi"):
            self.style.write_text(valid)
            self.assertEqual(self.run_generator(host).returncode, 0)
            output = self.root / ("agents/codex" if host == "codex" else "pi/agents")
            before = {file.name: file.read_bytes() for file in output.iterdir()}
            for text in invalid:
                with self.subTest(host=host, malformed=text[:40]):
                    self.style.write_text(text)
                    result = self.run_generator(host)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual({file.name: file.read_bytes() for file in output.iterdir()}, before)
            self.style.unlink()
            self.assertNotEqual(self.run_generator(host).returncode, 0)
            self.assertEqual({file.name: file.read_bytes() for file in output.iterdir()}, before)

    def test_hook_rejects_invalid_input_or_source_without_partial_context(self):
        valid = self.style.read_text()
        for payload, source in (("not JSON", valid),
                                ('{"hook_event_name":"Stop"}', valid),
                                ('{"hook_event_name":"SessionStart"}', START + "\npartial"),
                                ('{"hook_event_name":"SubagentStart"}', None)):
            with self.subTest(payload=payload, missing=source is None):
                if source is None:
                    self.style.unlink()
                else:
                    self.style.write_text(source)
                result = subprocess.run(
                    ["bash", str(self.root / "hooks/communication-standard.sh")],
                    input=payload, cwd=self.outside, capture_output=True, text=True, timeout=30,
                    env={**os.environ, "CLAUDE_PLUGIN_ROOT": str(self.root)},
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertTrue(result.stderr.startswith("acstack communication standard:"))
                self.assertEqual(len(result.stderr.splitlines()), 1)

    def test_hook_registration_and_events_outside_project(self):
        self.standard += '\n\nRuntime mutation with "quotes" and \\a backslash'
        self.style.write_text(START + "\n" + self.standard + "\n" + END)
        config = json.loads((self.root / "hooks/hooks.json").read_text())["hooks"]
        for event in ("SessionStart", "SubagentStart"):
            commands = [hook["command"] for group in config.get(event, []) for hook in group["hooks"]]
            self.assertTrue(any("communication-standard.sh" in command for command in commands), event)
            for fallback in (False, True):
                with self.subTest(event=event, fallback=fallback):
                    env = {**os.environ, "HOME": str(self.outside)}
                    env.pop("CLAUDE_PLUGIN_ROOT", None)
                    if not fallback:
                        env["CLAUDE_PLUGIN_ROOT"] = str(self.root)
                    command = (["bash", str(self.root / "hooks/communication-standard.sh")]
                               if fallback else ["bash", "-c", next(
                                   command for command in commands if "communication-standard.sh" in command)])
                    result = subprocess.run(
                        command,
                        input=json.dumps({"hook_event_name": event, "agent_type": "Explore"}),
                        cwd=self.outside, env=env, capture_output=True, text=True, timeout=30,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    context = json.loads(result.stdout)["hookSpecificOutput"]
                    self.assertEqual(context["hookEventName"], event)
                    self.assertEqual(context["additionalContext"].strip(), self.standard)
                    self.assertNotIn("orchestrator", context["additionalContext"].lower())


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CommunicationStandardTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    failed = len({test.id().split(" (")[0] for test, _ in result.failures + result.errors})
    print(f"Result: {result.testsRun - failed} passed, {failed} failed")
    raise SystemExit(not result.wasSuccessful())
