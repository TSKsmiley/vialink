# SPDX-License-Identifier: GPL-2.0-or-later
"""
Extracts vial-gui's keyboard layouts (View > Keyboard layout) into
src/core/keycodes/data/keymaps.json.

vial-gui's keymaps.py lists (display name, module.attribute) pairs; each
attribute in keymap/*.py is a literal dict of QMK id -> key cap label. Both are
read *statically* with the `ast` module: vial-gui's code is parsed as data and
never executed.

Usage:
    python3 -I scripts/dump_keymaps.py <path-to-vial-gui-checkout>

The output is checked into the repo; never edit it by hand.
"""
import ast
import json
import pathlib
import subprocess
import sys
import warnings

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "core" / "keycodes" / "data" / "keymaps.json"


def parse(path):
    # Some layout files contain "\ " in plain strings; Python keeps the backslash, and so does literal_eval.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def module_dicts(path):
    """Top-level `name = {...}` assignments of a keymap module."""
    out = {}
    for node in parse(path).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", SyntaxWarning)
                        out[target.id] = ast.literal_eval(node.value)
    return out


def keymap_list(path):
    """The KEYMAPS list: [(name, (module, attribute) | None)], None for the empty QWERTY dict."""
    for node in parse(path).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "KEYMAPS" for t in node.targets):
            entries = []
            for elt in node.value.elts:
                name = ast.literal_eval(elt.elts[0])
                ref = elt.elts[1]
                if isinstance(ref, ast.Attribute) and isinstance(ref.value, ast.Name):
                    entries.append((name, (ref.value.id, ref.attr)))
                elif isinstance(ref, ast.Call) and getattr(ref.func, "id", None) == "dict" and not ref.args:
                    entries.append((name, None))
                else:
                    raise SystemExit(f"KEYMAPS entry {name!r}: unexpected form {ast.dump(ref)}")
            return entries
    raise SystemExit("KEYMAPS not found in keymaps.py")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = pathlib.Path(sys.argv[1])
    py = root / "src" / "main" / "python"
    modules = {}
    keymaps = []
    for name, ref in keymap_list(py / "keymaps.py"):
        if ref is None:
            keymaps.append({"name": name, "labels": {}})
            continue
        module, attr = ref
        if module not in modules:
            modules[module] = module_dicts(py / "keymap" / f"{module}.py")
        if attr not in modules[module]:
            raise SystemExit(f"{module}.{attr} is not a literal dict")
        keymaps.append({"name": name, "labels": modules[module][attr]})
    try:
        commit = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True,
                                check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unknown"
    data = {
        "source": {"repo": "https://github.com/vial-kb/vial-gui", "commit": commit,
                   "files": "src/main/python/keymaps.py, src/main/python/keymap/*.py"},
        "keymaps": keymaps,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(keymaps)} keyboard layouts to {OUT}")


if __name__ == "__main__":
    main()
