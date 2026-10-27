"""Windows script checks using an isolated fixture, not the real frontend app."""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POWERSHELL = shutil.which("powershell.exe")


@unittest.skipUnless(os.name == "nt" and POWERSHELL, "Windows PowerShell is required")
class DevScriptsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cache = ROOT / ".cache"
        cache.mkdir(exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="dev scripts ", dir=cache)
        cls.root = Path(cls.temp.name)
        assert cls.root.resolve().is_relative_to(cache.resolve())
        shutil.copytree(
            ROOT / "scripts", cls.root / "scripts", ignore=shutil.ignore_patterns("__pycache__")
        )
        for name in ("start.ps1", "stop.ps1", "start.cmd", "stop.cmd"):
            shutil.copy2(ROOT / name, cls.root / name)
        cls.env = os.environ.copy()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_script(self, name, *args):
        # Use files: background Windows descendants may inherit a capture pipe handle.
        output_path = self.root / "test-output.log"
        with output_path.open("w") as output:
            result = subprocess.run(
                [
                    POWERSHELL,
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(self.root / name),
                    *args,
                ],
                cwd=ROOT,
                env=self.env,
                stdout=output,
                stderr=subprocess.STDOUT,
                timeout=45,
                check=False,
            )
        result.stdout = output_path.read_text(errors="replace")
        result.stderr = ""
        return result

    def test_01_options(self):
        for name, options in (
            ("start.ps1", ["--backend", "--frontend"]),
            ("stop.ps1", ["--backend", "--frontend"]),
            ("start.ps1", ["--unknown"]),
            ("stop.ps1", ["--restart"]),
            ("start.ps1", ["--frontend", "--frontend"]),
        ):
            with self.subTest(name=name, options=options):
                result = self.run_script(name, *options)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        result = self.run_script("start.ps1", "--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No selection means both", result.stdout)

    def test_02_default_selection_and_restart(self):
        command = (
            ". $args[0]; Read-DevOptions -Action start -Options @('--restart')"
            " | ConvertTo-Json -Compress"
        )
        # -Command arguments are parsed as PowerShell code, so quote paths explicitly.
        script_path = str(self.root / "scripts/dev-common.ps1").replace("'", "''")
        command = command.replace("$args[0]", f"'{script_path}'")
        result = subprocess.run(
            [POWERSHELL, "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        options = json.loads(result.stdout)
        self.assertEqual(options["Targets"], ["backend", "frontend"])
        self.assertTrue(options["Restart"])

    def test_03_missing_frontend_is_explicit(self):
        result = self.run_script("start.ps1", "--frontend")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Not implemented", result.stdout)
        self.assertFalse((self.root / ".run/frontend.json").exists())

    def test_04_frontend_lifecycle(self):
        frontend = self.root / "frontend"
        frontend.mkdir()
        (frontend / "node_modules").mkdir()
        (frontend / "package.json").write_text('{"scripts":{"dev":"test fixture"}}')
        bin_directory = self.root / "bin"
        bin_directory.mkdir()
        # A small HTTP server stands in for pnpm/Vite, including its child process tree.
        (bin_directory / "pnpm.cmd").write_text(
            f'@echo off\n"{sys.executable}" -u -m http.server %6 --bind 127.0.0.1\n'
        )
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.env["PATH"] = str(bin_directory) + os.pathsep + os.environ["PATH"]
        self.env["LOANSIGHT_FRONTEND_PORT"] = str(port)
        state_path = self.root / ".run/frontend.json"
        try:
            result = self.run_script("start.ps1", "--frontend")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Ready:", result.stdout)
            first_state = json.loads(state_path.read_text(encoding="utf-8-sig"))
            result = self.run_script("start.ps1", "--frontend")
            self.assertIn("Already running", result.stdout)
            self.assertEqual(json.loads(state_path.read_text(encoding="utf-8-sig")), first_state)
            result = self.run_script("start.ps1", "--frontend", "--restart")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            next_state = json.loads(state_path.read_text(encoding="utf-8-sig"))
            self.assertNotEqual(next_state["StartedTicks"], first_state["StartedTicks"])
            result = self.run_script("stop.ps1", "--frontend")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertFalse(state_path.exists())
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with socket.socket() as connection:
                    if connection.connect_ex(("127.0.0.1", port)) != 0:
                        break
                time.sleep(0.1)
            else:
                self.fail("Frontend child process still holds the port after stop")
            result = self.run_script("stop.ps1", "--frontend")
            self.assertIn("Already stopped", result.stdout)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", port))
                listener.listen()
                result = self.run_script("start.ps1", "--frontend", "--restart")
                self.assertEqual(result.returncode, 1)
                self.assertIn("unmanaged process", result.stdout)
                self.assertFalse(state_path.exists())
        finally:
            result = self.run_script("stop.ps1", "--frontend")
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)

    def test_05_stale_state_does_not_kill_an_unrelated_process(self):
        state_path = self.root / ".run/frontend.json"
        state_path.write_text(
            json.dumps(
                {
                    "ProcessId": os.getpid(),
                    "StartedTicks": "0",
                    "ProjectRoot": str(self.root),
                    "Port": 5173,
                }
            )
        )
        result = self.run_script("stop.ps1", "--frontend")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Already stopped", result.stdout)
        self.assertFalse(state_path.exists())

    def test_06_cmd_wrapper_forwards_arguments_and_exit_code(self):
        for name in ("start.cmd", "stop.cmd"):
            for options, expected in (("--help", 0), ("--frontend --backend", 1)):
                result = subprocess.run(
                    [os.environ["COMSPEC"], "/d", "/c", name, *options.split()],
                    cwd=self.root,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
