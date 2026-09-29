import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Chrome's page translation replaces each text node with a <font> holding the translation. React keeps the
// original node, so placing an element before it throws NotFoundError ("insertBefore … is not a child of this
// node") and the app falls into the error boundary. A child that switches elements (a spinner for an icon)
// must therefore never sit directly before text: the text goes in its own element.

const SRC = path.resolve(import.meta.dirname);

const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);
const isString = (e: ts.Expression) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);
const isOr = (e: ts.BinaryExpression) =>
  [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind);

/** A child that renders as text, e.g. `Label`, `{"Label"}` or `{busy ? "Saving" : "Save"}`. */
function isText(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) return child.text.trim() !== "";
  if (!ts.isJsxExpression(child) || !child.expression) return false;
  const e = unwrap(child.expression);
  return isString(e) || (ts.isConditionalExpression(e) && isString(unwrap(e.whenTrue)) && isString(unwrap(e.whenFalse)));
}

/** A child whose element can change between renders: `{a ? <X /> : <Y />}`, `{a && <X />}`, `{list.map(…)}`. */
function isSwitching(child: ts.JsxChild): boolean {
  if (!ts.isJsxExpression(child) || !child.expression || isText(child)) return false;
  const e = unwrap(child.expression);
  if (ts.isConditionalExpression(e)) return true;
  if (ts.isBinaryExpression(e)) return isOr(e);
  return ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "map";
}

function switchingBeforeText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children.filter(child => !ts.isJsxText(child) || child.text.trim() !== "");
      children.forEach((child, i) => {
        if (isSwitching(child) && i + 1 < children.length && isText(children[i + 1])) {
          const line = source.getLineAndCharacterOfPosition(child.getStart()).line + 1;
          found.push(`${path.relative(SRC, file)}:${line}`);
        }
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter(file => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
  .map(file => path.join(SRC, file));

describe("pages that survive page translation", () => {
  it("never put an element that can change directly before text", () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.flatMap(switchingBeforeText)).toEqual([]);
  });
});
