# SPDX-License-Identifier: GPL-2.0-or-later
"""
Extracts vial-gui's keycode tables into src/core/keycodes/data/keycodes.json.

The tables are read *statically* with the `ast` module: vial-gui's code is
parsed as data and never executed. That covers the literal dicts in
keycodes_v5.py / keycodes_v6.py and the K(...) lists in keycodes.py. The few
generated entries (M0..M255, TD(n), MO(n), ... built by `for` loops at the
bottom of keycodes_v5/v6.py) are reproduced here, and the script fails if the
loop source in vial-gui no longer matches what it reproduces.

Usage:
    python3 -I scripts/dump_keycodes.py <path-to-vial-gui-checkout>

The output is checked into the repo; never edit it by hand.
"""
import ast
import json
import pathlib
import subprocess
import sys

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "core" / "keycodes" / "data" / "keycodes.json"

# keycodes.py lists, in the order vial-gui concatenates them in recreate_keycodes().
STATIC_LISTS = [
    "KEYCODES_SPECIAL",
    "KEYCODES_BASIC",
    "KEYCODES_BASIC_NUMPAD",
    "KEYCODES_BASIC_NAV",
    "KEYCODES_SHIFTED",
    "KEYCODES_ISO",
    "KEYCODES_ISO_KR",
    "KEYCODES_BOOT",
    "KEYCODES_MODIFIERS",
    "KEYCODES_QUANTUM",
    "KEYCODES_BACKLIGHT",
    "KEYCODES_MEDIA",
    "KEYCODES_MACRO_BASE",
    "KEYCODES_MIDI_BASIC",
    "KEYCODES_MIDI_ADVANCED",
]

# `.extend()` calls at module level that vial-gui applies after the literals.
EXPECTED_EXTENDS = {
    ("KEYCODES_BASIC", "KEYCODES_BASIC_NUMPAD"),
    ("KEYCODES_BASIC", "KEYCODES_BASIC_NAV"),
    ("KEYCODES_ISO", "KEYCODES_ISO_KR"),
}

K_PARAMS = ["qmk_id", "label", "tooltip", "masked", "printable", "recorder_alias", "alias", "requires_feature"]

# The generator loops at the bottom of keycodes_v5.py / keycodes_v6.py, verbatim
# (whitespace-normalized). If vial-gui changes them, the dump stops and this
# script must be updated alongside `generate()` below.
LOOPS = {
    5: [
        'keycodes_v5.kc["M{}".format(x)] = keycodes_v5.kc["QK_MACRO"] + x',
        'keycodes_v5.kc["TD({})".format(x)] = keycodes_v5.kc["QK_TAP_DANCE"] + x',
        'keycodes_v5.kc["MO({})".format(x)] = keycodes_v5.kc["QK_MOMENTARY"] | x',
        'keycodes_v5.kc["DF({})".format(x)] = keycodes_v5.kc["QK_DEF_LAYER"] | x',
        'keycodes_v5.kc["TG({})".format(x)] = keycodes_v5.kc["QK_TOGGLE_LAYER"] | x',
        'keycodes_v5.kc["TT({})".format(x)] = keycodes_v5.kc["QK_LAYER_TAP_TOGGLE"] | x',
        'keycodes_v5.kc["OSL({})".format(x)] = keycodes_v5.kc["QK_ONE_SHOT_LAYER"] | x',
        'keycodes_v5.kc["TO({})".format(x)] = keycodes_v5.kc["QK_TO"] | (1 << 4) | x',
        'keycodes_v5.kc["PDF({})".format(x)] = keycodes_v5.kc["QK_PERSISTENT_DEF_LAYER"] + x',
        'keycodes_v5.kc["LT{}(kc)".format(x)] = keycodes_v5.kc["QK_LAYER_TAP"] | (((x) & 0xF) << 8)',
        'keycodes_v5.kc["USER{:02}".format(x)] = keycodes_v5.kc["QK_KB"] + x',
    ],
    6: [
        'keycodes_v6.kc["M{}".format(x)] = keycodes_v6.kc["QK_MACRO"] + x',
        'keycodes_v6.kc["TD({})".format(x)] = keycodes_v6.kc["QK_TAP_DANCE"] + x',
        'keycodes_v6.kc["MO({})".format(x)] = keycodes_v6.kc["QK_MOMENTARY"] + x',
        'keycodes_v6.kc["DF({})".format(x)] = keycodes_v6.kc["QK_DEF_LAYER"] + x',
        'keycodes_v6.kc["TG({})".format(x)] = keycodes_v6.kc["QK_TOGGLE_LAYER"] + x',
        'keycodes_v6.kc["TT({})".format(x)] = keycodes_v6.kc["QK_LAYER_TAP_TOGGLE"] + x',
        'keycodes_v6.kc["OSL({})".format(x)] = keycodes_v6.kc["QK_ONE_SHOT_LAYER"] + x',
        'keycodes_v6.kc["TO({})".format(x)] = keycodes_v6.kc["QK_TO"] + x',
        'keycodes_v6.kc["PDF({})".format(x)] = keycodes_v6.kc["QK_PERSISTENT_DEF_LAYER"] + x',
        'keycodes_v6.kc["LT{}(kc)".format(x)] = keycodes_v6.kc["QK_LAYER_TAP"] | (((x) & 0xF) << 8)',
        'keycodes_v6.kc["USER{:02}".format(x)] = keycodes_v6.kc["QK_KB"] + x',
    ],
}


def generate(version, kc):
    """Reproduces the `for` loops of keycodes_v{version}.py."""
    for x in range(256):
        kc["M{}".format(x)] = kc["QK_MACRO"] + x
        kc["TD({})".format(x)] = kc["QK_TAP_DANCE"] + x
    for x in range(32):
        if version == 5:
            kc["MO({})".format(x)] = kc["QK_MOMENTARY"] | x
            kc["DF({})".format(x)] = kc["QK_DEF_LAYER"] | x
            kc["TG({})".format(x)] = kc["QK_TOGGLE_LAYER"] | x
            kc["TT({})".format(x)] = kc["QK_LAYER_TAP_TOGGLE"] | x
            kc["OSL({})".format(x)] = kc["QK_ONE_SHOT_LAYER"] | x
            kc["TO({})".format(x)] = kc["QK_TO"] | (1 << 4) | x
        else:
            kc["MO({})".format(x)] = kc["QK_MOMENTARY"] + x
            kc["DF({})".format(x)] = kc["QK_DEF_LAYER"] + x
            kc["TG({})".format(x)] = kc["QK_TOGGLE_LAYER"] + x
            kc["TT({})".format(x)] = kc["QK_LAYER_TAP_TOGGLE"] + x
            kc["OSL({})".format(x)] = kc["QK_ONE_SHOT_LAYER"] + x
            kc["TO({})".format(x)] = kc["QK_TO"] + x
        kc["PDF({})".format(x)] = kc["QK_PERSISTENT_DEF_LAYER"] + x
    for x in range(16):
        kc["LT{}(kc)".format(x)] = kc["QK_LAYER_TAP"] | (((x) & 0xF) << 8)
    for x in range(64):
        kc["USER{:02}".format(x)] = kc["QK_KB"] + x


def norm(s):
    return " ".join(s.split())


def read_version_table(path, version):
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    kc = None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "keycodes_v{}".format(version):
            for stmt in node.body:
                if isinstance(stmt, ast.Assign) and stmt.targets[0].id == "kc":
                    kc = ast.literal_eval(stmt.value)
    if kc is None:
        sys.exit("could not find keycodes_v{}.kc in {}".format(version, path))

    # Check the generator loops still say what generate() reproduces.
    loop_lines = []
    for node in tree.body:
        if isinstance(node, ast.For):
            for stmt in node.body:
                if isinstance(stmt, ast.Assign):
                    loop_lines.append(norm(ast.get_source_segment(src, stmt)))
    expected = [norm(line) for line in LOOPS[version]]
    if loop_lines != expected:
        sys.exit("generator loops in {} changed; update dump_keycodes.py.\nfound:\n  {}".format(
            path, "\n  ".join(loop_lines)))

    generate(version, kc)
    masked = sorted({val for name, val in kc.items() if name.endswith("(kc)")})
    return {"kc": kc, "masked": masked}


def keycode_from_call(call):
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "K"):
        raise ValueError("expected K(...) call, got {}".format(ast.dump(call)))
    out = {}
    for name, arg in zip(K_PARAMS, call.args):
        out[name] = ast.literal_eval(arg)
    for kw in call.keywords:
        if kw.arg not in K_PARAMS:
            raise ValueError("unknown K() keyword {}".format(kw.arg))
        out[kw.arg] = ast.literal_eval(kw.value)
    entry = {"qmk_id": out["qmk_id"], "label": out["label"]}
    for key in ["tooltip", "masked", "printable", "alias", "requires_feature"]:
        if out.get(key):
            entry[key] = out[key]
    return entry


def read_lists(path):
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    lists = {}
    extends = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in STATIC_LISTS:
                if not isinstance(node.value, ast.List):
                    sys.exit("{} is not a list literal".format(name))
                lists[name] = [keycode_from_call(e) for e in node.value.elts]
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            func = node.value.func
            if isinstance(func, ast.Attribute) and func.attr == "extend" and isinstance(func.value, ast.Name):
                if func.value.id in STATIC_LISTS:
                    extends.add((func.value.id, node.value.args[0].id))
    missing = [n for n in STATIC_LISTS if n not in lists]
    if missing:
        sys.exit("lists not found in keycodes.py: {}".format(missing))
    if extends != EXPECTED_EXTENDS:
        sys.exit("module-level extend() calls changed: {}".format(sorted(extends)))
    return lists


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = pathlib.Path(sys.argv[1]).resolve()
    kcdir = root / "src" / "main" / "python" / "keycodes"
    try:
        commit = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True,
                                check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unknown"

    data = {
        "source": {"repo": "https://github.com/vial-kb/vial-gui", "commit": commit,
                   "files": ["keycodes/keycodes.py", "keycodes/keycodes_v5.py", "keycodes/keycodes_v6.py"]},
        "v5": read_version_table(kcdir / "keycodes_v5.py", 5),
        "v6": read_version_table(kcdir / "keycodes_v6.py", 6),
        "lists": read_lists(kcdir / "keycodes.py"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote {} ({} v5 / {} v6 constants)".format(OUT, len(data["v5"]["kc"]), len(data["v6"]["kc"])))


if __name__ == "__main__":
    main()
