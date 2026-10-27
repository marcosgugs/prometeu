import vocabulary from "./analytics-events.ts?raw";
import ts from "typescript";
import { expect, it } from "vitest";
import fixtures from "../src-tauri/tests/fixtures/product-analytics.json";

it("exercises every frontend feature event through the native contract fixtures", () => {
  const source = ts.createSourceFile("analytics-events.ts", vocabulary, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === "FeatureEvent")!;
  expect(ts.isUnionTypeNode(declaration.type)).toBe(true);
  const variants = (declaration.type as ts.UnionTypeNode).types.map(node => {
    expect(ts.isTypeLiteralNode(node)).toBe(true);
    return (node as ts.TypeLiteralNode).members as ts.NodeArray<ts.PropertySignature>;
  });
  const names = variants.map(members => ((members.find(member => member.name?.getText(source) === "name")!.type as ts.LiteralTypeNode).literal as ts.StringLiteral).text);
  expect(fixtures.map(event => event.name).sort()).toEqual(names.sort());
  for (const members of variants) {
    const name = ((members.find(member => member.name?.getText(source) === "name")!.type as ts.LiteralTypeNode).literal as ts.StringLiteral).text;
    const sample = fixtures.find(event => event.name === name)! as Record<string, unknown>;
    expect(Object.keys(sample).sort()).toEqual(members.map(member => member.name!.getText(source)).sort());
    for (const member of members) {
      const value = sample[member.name!.getText(source)];
      const type = member.type!;
      if (type.kind === ts.SyntaxKind.BooleanKeyword) expect(typeof value).toBe("boolean");
      else if (ts.isTypeReferenceNode(type)) expect(["claude", "codex", "antigravity", "gemini"]).toContain(value);
      else {
        const choices = ts.isUnionTypeNode(type) ? type.types : [type];
        expect(choices.map(choice => ((choice as ts.LiteralTypeNode).literal as ts.StringLiteral).text)).toContain(value);
      }
    }
  }
});
