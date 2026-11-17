"""Python SDK — thin, typed-ish wrapper over the `fit` CLI (--json contract).

Why a subprocess instead of reimplementing the registry format: the CLI contract
IS the public interface. One source of truth, no format drift between SDKs.

    from fit_sdk import Fit
    fit = Fit()                       # uses FIT_ROOT or D:\\env
    fit.register_agent("my-agent", capabilities=["registry.read"])
    for ep in fit.list(kind="skill"):
        print(ep["name"])
    print(fit.probe("node"))
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable, Optional

_DEFAULT_BIN = Path(__file__).resolve().parents[2] / "bin" / "fit.mjs"


class FitError(RuntimeError):
    pass


class Fit:
    def __init__(self, root: Optional[str] = None, fit_bin: Optional[str | Path] = None, node: str = "node"):
        self.root = root
        self.node = node
        self.fit_bin = Path(fit_bin) if fit_bin else _DEFAULT_BIN

    # ---------------------------------------------------------------- plumbing
    def _run(self, args: Iterable[str]) -> Any:
        if not self.fit_bin.exists():
            raise FitError(f"fit CLI not found at {self.fit_bin}")
        cmd = [self.node, str(self.fit_bin), *args]
        if self.root:
            cmd += ["--root", self.root]
        cmd.append("--json")
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if proc.returncode != 0:
            raise FitError((proc.stderr or proc.stdout or "fit failed").strip())
        out = (proc.stdout or "").strip()
        if not out:
            return None
        try:
            return json.loads(out)
        except json.JSONDecodeError as exc:  # pragma: no cover - defensive
            raise FitError(f"non-JSON output from fit: {out[:200]}") from exc

    # ------------------------------------------------------------------- reads
    def list(self, kind: Optional[str] = None) -> list[dict[str, Any]]:
        args = ["list"]
        if kind:
            args += ["--kind", kind]
        return self._run(args) or []

    def agents(self) -> list[dict[str, Any]]:
        return self._run(["list", "--agents"]) or []

    def resolve(self, name: str, kind: Optional[str] = None) -> dict[str, Any]:
        args = ["resolve", name]
        if kind:
            args += ["--kind", kind]
        return self._run(args)

    def probe(self, name: str, kind: Optional[str] = None) -> dict[str, Any]:
        args = ["probe", name]
        if kind:
            args += ["--kind", kind]
        return self._run(args)

    def stats(self) -> dict[str, Any]:
        return self._run(["doctor"])

    # ------------------------------------------------------------------ writes
    def register(self, kind: str, name: str, **fields: Any) -> dict[str, Any]:
        args = ["register", kind, name]
        for key, value in fields.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                value = ",".join(str(v) for v in value)
            args += [f"--{key}", str(value)]
        return self._run(args)

    def register_agent(
        self,
        name: str,
        capabilities: Optional[list[str]] = None,
        transport: str = "python-sdk",
        endpoint: Optional[str] = None,
    ) -> dict[str, Any]:
        args = ["agent", "register", name, "--transport", transport]
        if capabilities:
            args += ["--capabilities", ",".join(capabilities)]
        if endpoint:
            args += ["--endpoint", endpoint]
        return self._run(args)

    def unregister(self, name: str, kind: Optional[str] = None) -> dict[str, Any]:
        args = ["unregister", name]
        if kind:
            args += ["--kind", kind]
        return self._run(args)

    # ------------------------------------------------------------------ helper
    @staticmethod
    def available() -> bool:
        return shutil.which("node") is not None
