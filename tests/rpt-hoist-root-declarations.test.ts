import { expect, test } from "bun:test";
import { hoistRootDeclarations } from "../dot_local/lib/rpt/src/hoist-root-declarations.ts";

function hoisted(css: string): string {
  const result = hoistRootDeclarations(css);
  expect(result.startsWith(css)).toBe(true);
  return result.slice(css.length);
}

test("hoists custom properties declared on :root", () => {
  expect(hoisted(":root{--w-color-primary: hsl(0, 0%, 5%)}")).toBe(
    ":host,.rpt-shell{--w-color-primary: hsl(0, 0%, 5%)}",
  );
});

test("hoists custom properties declared on body", () => {
  expect(hoisted("body{--w-md-radius: 5px}")).toBe(
    ":host,.rpt-shell{--w-md-radius: 5px}",
  );
});

test("hoists the inherited baseline but not layout declarations", () => {
  expect(
    hoisted(
      "body{background:var(--w-color-primary-70);color:var(--w-color-primary);font-size:16px;margin:0}",
    ),
  ).toBe(
    ":host,.rpt-shell{background:var(--w-color-primary-70);color:var(--w-color-primary);font-size:16px}",
  );
});

test("keeps the enclosing at-rule context", () => {
  expect(hoisted("@media (min-width:600px){:root{--w-breakpoint: sm}}")).toBe(
    "@media (min-width:600px){:host,.rpt-shell{--w-breakpoint: sm}}",
  );
});

test("keeps nested at-rule context", () => {
  expect(
    hoisted("@supports (color:hsl(0 0% 0%)){@media print{body{--w-md-radius: 0}}}"),
  ).toBe(
    "@supports (color:hsl(0 0% 0%)){@media print{:host,.rpt-shell{--w-md-radius: 0}}}",
  );
});

test("groups declarations that share an at-rule context", () => {
  expect(hoisted(":root{--a: 1}body{--b: 2}@media print{:root{--c: 3}}")).toBe(
    ":host,.rpt-shell{--a: 1;--b: 2}@media print{:host,.rpt-shell{--c: 3}}",
  );
});

test("hoists declarations from a selector list containing the root", () => {
  expect(hoisted(":root,.theme{--a: 1}")).toBe(":host,.rpt-shell{--a: 1}");
});

test("preserves !important", () => {
  expect(hoisted("body{color:red!important}")).toBe(
    ":host,.rpt-shell{color:red!important}",
  );
});

test("ignores selectors that only contain the root as a compound part", () => {
  for (const css of [
    ":root .card{--a: 1}",
    "body .card{--a: 1}",
    "body.dark{--a: 1}",
    ".rpt-body{--a: 1}",
    "html{--a: 1}",
  ]) {
    expect(hoistRootDeclarations(css)).toBe(css);
  }
});

test("leaves a stylesheet without root declarations untouched", () => {
  const css = ".rpt-shell{max-width:72rem}";
  expect(hoistRootDeclarations(css)).toBe(css);
});
