// SPDX-License-Identifier: GPL-2.0-or-later
// Keycode expressions typed by hand ("Any" key), e.g. "LCTL(KC_A)",
// "LT(2, KC_SPC)", "MT(MOD_LCTL | MOD_LSFT, KC_ESC)" or "0x7c00".
//
// Port of vial-gui's any_keycode.py. vial-gui evaluates the text with
// simpleeval; this is a small dedicated parser with the same names, functions
// and operators (| ^ & + - * // % and unary + -), and nothing else.

export class KeycodeExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeycodeExpressionError";
  }
}

export interface ExpressionScope {
  names: ReadonlyMap<string, number>;
  functions: ReadonlyMap<string, (...args: number[]) => number>;
}

type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v: "(" }
  | { t: ")"; v: ")" }
  | { t: ","; v: "," };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*)/.exec(src.slice(i));
    if (num) {
      const text = num[0].replace(/_/g, "");
      const lower = text.toLowerCase();
      let v: number;
      if (lower.startsWith("0x")) v = parseInt(lower.slice(2), 16);
      else if (lower.startsWith("0b")) v = parseInt(lower.slice(2), 2);
      else if (lower.startsWith("0o")) v = parseInt(lower.slice(2), 8);
      else if (/^0[0-9]+$/.test(text)) throw new KeycodeExpressionError(`invalid number "${text}"`);
      else v = parseInt(text, 10);
      out.push({ t: "num", v });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) {
      out.push({ t: "name", v: name[0] });
      i += name[0].length;
      continue;
    }
    if (src.startsWith("//", i)) {
      out.push({ t: "op", v: "//" });
      i += 2;
      continue;
    }
    if ("|^&+-*%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ t: ch, v: ch } as Token);
      i++;
      continue;
    }
    throw new KeycodeExpressionError(`unexpected character "${ch}"`);
  }
  return out;
}

// Python precedence, lowest first.
const BINARY: Record<string, number> = { "|": 1, "^": 2, "&": 3, "+": 4, "-": 4, "*": 5, "//": 5, "%": 5 };

export function evaluateKeycodeExpression(src: string, scope: ExpressionScope): number {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  const parseUnary = (): number => {
    const tok = peek();
    if (tok?.t === "op" && (tok.v === "-" || tok.v === "+")) {
      next();
      const v = parseUnary();
      return tok.v === "-" ? -v : v;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = next();
    if (!tok) throw new KeycodeExpressionError("unexpected end of expression");
    if (tok.t === "num") return tok.v;
    if (tok.t === "(") {
      const v = parseBinary(0);
      if (next()?.t !== ")") throw new KeycodeExpressionError('missing ")"');
      return v;
    }
    if (tok.t === "name") {
      if (peek()?.t === "(") {
        next();
        const fn = scope.functions.get(tok.v);
        if (!fn) throw new KeycodeExpressionError(`unknown function "${tok.v}"`);
        const args: number[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            args.push(parseBinary(0));
            const sep = next();
            if (sep?.t === ")") break;
            if (sep?.t !== ",") throw new KeycodeExpressionError(`expected "," or ")" in call to ${tok.v}`);
          }
        } else {
          next();
        }
        if (args.length !== fn.length) {
          throw new KeycodeExpressionError(`${tok.v}() takes ${fn.length} argument(s), got ${args.length}`);
        }
        return fn(...args);
      }
      const v = scope.names.get(tok.v);
      if (v === undefined) throw new KeycodeExpressionError(`unknown name "${tok.v}"`);
      return v;
    }
    throw new KeycodeExpressionError(`unexpected "${tok.v}"`);
  };

  const parseBinary = (minPrec: number): number => {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (tok?.t !== "op") return left;
      const prec = BINARY[tok.v];
      if (prec === undefined || prec < minPrec) return left;
      next();
      const right = parseBinary(prec + 1);
      left = applyBinary(tok.v, left, right);
    }
  };

  const value = parseBinary(0);
  if (pos !== tokens.length) throw new KeycodeExpressionError(`unexpected "${tokens[pos].v}"`);
  return value;
}

function applyBinary(op: string, a: number, b: number): number {
  switch (op) {
    case "|":
      return a | b;
    case "^":
      return a ^ b;
    case "&":
      return a & b;
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "//":
      if (b === 0) throw new KeycodeExpressionError("division by zero");
      return Math.floor(a / b);
    case "%":
      if (b === 0) throw new KeycodeExpressionError("division by zero");
      return ((a % b) + b) % b;
  }
  throw new KeycodeExpressionError(`unknown operator ${op}`);
}

/** The function table of any_keycode.py, bound to one protocol's constants. */
export function keycodeFunctions(r: (name: string) => number): Map<string, (...args: number[]) => number> {
  const f = new Map<string, (...args: number[]) => number>();
  const mod =
    (...names: string[]) =>
    (kc: number) =>
      names.reduce((acc, n) => acc | r(n), 0) | kc;

  const LCTL = mod("QK_LCTL");
  const LSFT = mod("QK_LSFT");
  const LALT = mod("QK_LALT");
  const LGUI = mod("QK_LGUI");
  const RCTL = mod("QK_RCTL");
  const RSFT = mod("QK_RSFT");
  const RALT = mod("QK_RALT");
  const RGUI = mod("QK_RGUI");
  const C_S = mod("QK_LCTL", "QK_LSFT");
  const HYPR = mod("QK_LCTL", "QK_LSFT", "QK_LALT", "QK_LGUI");
  const MEH = mod("QK_LCTL", "QK_LSFT", "QK_LALT");
  const LCAG = mod("QK_LCTL", "QK_LALT", "QK_LGUI");
  const SGUI = mod("QK_LGUI", "QK_LSFT");
  const LCA = mod("QK_LCTL", "QK_LALT");
  const LSA = mod("QK_LSFT", "QK_LALT");
  const LAG = mod("QK_LALT", "QK_LGUI");
  const RSA = mod("QK_RSFT", "QK_RALT");
  const RCS = mod("QK_RCTL", "QK_RSFT");
  const LCG = mod("QK_LCTL", "QK_LGUI");
  const RCG = mod("QK_RCTL", "QK_RGUI");

  const LT = (layer: number, kc: number) => r("QK_LAYER_TAP") | ((layer & 0xf) << 8) | (kc & 0xff);
  // Same expression as any_keycode.py, including ON_PRESS << 4. On v6 this
  // differs from the TO(n) table entries (0x5200 + n); vial-gui only reaches
  // this path for TO(n) with n beyond the board's layer count.
  const TO = (layer: number) => r("QK_TO") | (r("ON_PRESS") << 0x4) | (layer & 0xff);
  const MO = (layer: number) => r("QK_MOMENTARY") | (layer & 0xff);
  const DF = (layer: number) => r("QK_DEF_LAYER") | (layer & 0xff);
  const TG = (layer: number) => r("QK_TOGGLE_LAYER") | (layer & 0xff);
  const OSL = (layer: number) => r("QK_ONE_SHOT_LAYER") | (layer & 0xff);
  const LM = (layer: number, m: number) =>
    r("QK_LAYER_MOD") | ((layer & 0xf) << r("QMK_LM_SHIFT")) | (m & r("QMK_LM_MASK"));
  const OSM = (m: number) => r("QK_ONE_SHOT_MOD") | (m & 0xff);
  const TT = (layer: number) => r("QK_LAYER_TAP_TOGGLE") | (layer & 0xff);
  const MT = (m: number, kc: number) => r("QK_MOD_TAP") | ((m & 0x1f) << 8) | (kc & 0xff);
  const TD = (n: number) => r("QK_TAP_DANCE") | (n & 0xff);
  const mt =
    (...mods: string[]) =>
    (kc: number) =>
      MT(
        mods.reduce((acc, n) => acc | r(n), 0),
        kc,
      );

  const LCTL_T = mt("MOD_LCTL");
  const RCTL_T = mt("MOD_RCTL");
  const LSFT_T = mt("MOD_LSFT");
  const RSFT_T = mt("MOD_RSFT");
  const LALT_T = mt("MOD_LALT");
  const RALT_T = mt("MOD_RALT");
  const LGUI_T = mt("MOD_LGUI");
  const RGUI_T = mt("MOD_RGUI");
  const C_S_T = mt("MOD_LCTL", "MOD_LSFT");
  const MEH_T = mt("MOD_LCTL", "MOD_LSFT", "MOD_LALT");
  const LCAG_T = mt("MOD_LCTL", "MOD_LALT", "MOD_LGUI");
  const RCAG_T = mt("MOD_RCTL", "MOD_RALT", "MOD_RGUI");
  const HYPR_T = mt("MOD_LCTL", "MOD_LSFT", "MOD_LALT", "MOD_LGUI");
  const SGUI_T = mt("MOD_LGUI", "MOD_LSFT");
  const LCA_T = mt("MOD_LCTL", "MOD_LALT");
  const LSA_T = mt("MOD_LSFT", "MOD_LALT");
  const LAG_T = mt("MOD_LALT", "MOD_LGUI");
  const RSA_T = mt("MOD_RSFT", "MOD_RALT");
  const RCS_T = mt("MOD_RCTL", "MOD_RSFT");
  const LCG_T = mt("MOD_LCTL", "MOD_LGUI");
  const RCG_T = mt("MOD_RCTL", "MOD_RGUI");

  // prettier-ignore
  const table: Record<string, (...args: number[]) => number> = {
    LCTL, LSFT, LALT, LGUI, LOPT: LALT, LCMD: LGUI, LWIN: LGUI,
    RCTL, RSFT, RALT, RGUI, ALGR: RALT, ROPT: RALT, RCMD: RGUI, RWIN: RGUI,
    HYPR, MEH, LCAG, SGUI, SCMD: SGUI, SWIN: SGUI, LSG: SGUI,
    C_S,
    LCA, LSA, LAG, RSA, RCS, SAGR: RSA,
    C: LCTL, S: LSFT, A: LALT, G: LGUI,
    LT, TO, MO, DF, TG, OSL, LM, OSM, TT, MT,
    LCTL_T, RCTL_T, CTL_T: LCTL_T,
    LSFT_T, RSFT_T, SFT_T: LSFT_T,
    LALT_T, RALT_T, LOPT_T: LALT_T, ROPT_T: RALT_T, ALGR_T: RALT_T, ALT_T: LALT_T, OPT_T: LALT_T,
    LGUI_T, RGUI_T, LCMD_T: LGUI_T, LWIN_T: LGUI_T, RCMD_T: RGUI_T, RWIN_T: RGUI_T,
    GUI_T: LGUI_T, CMD_T: LGUI_T, WIN_T: LGUI_T,
    C_S_T, MEH_T,
    LCAG_T, RCAG_T, HYPR_T, SGUI_T, SCMD_T: SGUI_T, SWIN_T: SGUI_T,
    LSG_T: SGUI_T,
    LCA_T, LSA_T, LAG_T, RSA_T, RCS_T, SAGR_T: RSA_T, ALL_T: HYPR_T,
    TD,
    LCG, RCG, LCG_T, RCG_T,
  };
  for (const [name, fn] of Object.entries(table)) f.set(name, fn);
  for (let x = 0; x < 16; x++) {
    f.set(`LT${x}`, (kc: number) => r("QK_LAYER_TAP") | ((x & 0xf) << 8) | (kc & 0xff));
  }
  return f;
}
