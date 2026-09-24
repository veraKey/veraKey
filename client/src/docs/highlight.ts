/** A small, dependency-free highlighter for the languages the docs show. Lossless: the tokens'
 *  text joined together is always the input. */
export type Lang = "ts" | "bash" | "rust" | "solidity" | "json" | "text";
export type TokenType = "keyword" | "string" | "comment" | "number" | "type" | "function" | "plain";
export interface Token {
  type: TokenType;
  text: string;
}

const KEYWORDS: Record<"ts" | "bash" | "rust" | "solidity" | "json", string[]> = {
  ts: ["import", "from", "export", "const", "let", "var", "function", "return", "await", "async", "if", "else", "for", "of", "in", "new", "class", "interface", "type", "extends", "throw", "try", "catch", "finally", "as", "default", "null", "undefined", "true", "false", "typeof", "void"],
  bash: ["if", "then", "fi", "for", "do", "done", "export", "cd", "echo", "set", "case", "esac", "while", "in"],
  rust: ["fn", "pub", "let", "mut", "impl", "struct", "enum", "use", "mod", "match", "if", "else", "return", "self", "Self", "crate", "const", "for", "in", "as", "true", "false", "where", "trait"],
  solidity: ["function", "contract", "interface", "library", "returns", "return", "external", "public", "internal", "private", "view", "pure", "payable", "memory", "calldata", "storage", "uint256", "uint64", "uint8", "bytes32", "bytes", "address", "bool", "string", "if", "else", "require", "revert", "emit", "event", "error", "mapping", "constant", "immutable", "true", "false"],
  json: ["true", "false", "null"],
};

function pattern(lang: Exclude<Lang, "text">): RegExp {
  const comment =
    lang === "bash" ? String.raw`(?:^|(?<=\s))#[^\n]*` : lang === "json" ? "(?!)" : String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`;
  const string = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'` + (lang === "ts" ? String.raw`|\`(?:\\.|[^\`\\])*\`` : "");
  const number = String.raw`\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?\b`;
  const ident = String.raw`[A-Za-z_$][\w$]*`;
  return new RegExp(`(${comment})|(${string})|(${number})|(${ident})|([\\s\\S])`, "gm");
}

export function tokenize(code: string, lang: Lang): Token[] {
  if (lang === "text") return [{ type: "plain", text: code }];
  const keywords = new Set(KEYWORDS[lang]);
  const tokens: Token[] = [];
  const push = (type: TokenType, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && type === "plain" && last.type === "plain") last.text += text;
    else tokens.push({ type, text });
  };
  const re = pattern(lang);
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const [text, comment, string, number, ident] = m;
    if (comment !== undefined) push("comment", text);
    else if (string !== undefined) push("string", text);
    else if (number !== undefined) push("number", text);
    else if (ident !== undefined) {
      let next = re.lastIndex;
      while (code[next] === " ") next++;
      if (keywords.has(text)) push("keyword", text);
      else if (code[next] === "(") push("function", text);
      else if (/^[A-Z]/.test(text) && lang !== "bash") push("type", text);
      else push("plain", text);
    } else push("plain", text);
  }
  return tokens;
}
