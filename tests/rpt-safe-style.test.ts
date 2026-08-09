import { expect, test } from "bun:test";
import { safeStyleViolation } from "../dot_local/lib/rpt/src/safe-style.ts";

const allowed = [
  "color: #123; padding: 1rem; display: grid; gap: 0.5rem",
  "grid-template-columns: repeat(2, minmax(0, 1fr))",
  "color: var(--w-color-success)",
  "c\\6flor: red",
  "background-color: transparent; font-family: system-ui; font-size: 1rem",
  "font-style: italic; font-weight: 700; line-height: 1.5",
  "letter-spacing: 0.1em; text-align: center; text-decoration: underline",
  "text-transform: uppercase; white-space: normal; overflow-wrap: break-word",
  "word-break: break-word; vertical-align: middle; box-sizing: border-box",
  "margin: 1rem; margin-top: 1rem; margin-right: 1rem; margin-bottom: 1rem; margin-left: 1rem",
  "padding-top: 1rem; padding-right: 1rem; padding-bottom: 1rem; padding-left: 1rem",
  "border: 1px solid #000; border-top-width: 1px; border-right-width: 1px",
  "border-bottom-width: 1px; border-left-width: 1px; border-top-style: solid",
  "border-right-style: solid; border-bottom-style: solid; border-left-style: solid",
  "border-top-color: #000; border-right-color: #000; border-bottom-color: #000; border-left-color: #000",
  "border-radius: 1rem; width: 1rem; min-width: 1rem; max-width: 1rem",
  "height: 1rem; min-height: 1rem; max-height: 1rem; overflow-x: auto; overflow-y: hidden",
  "row-gap: 1rem; column-gap: 1rem; flex-direction: column; flex-wrap: wrap",
  "flex-grow: 1; flex-shrink: 0; flex-basis: auto; justify-content: center",
  "align-items: center; align-content: center; grid-template-rows: auto; grid-column: 1; grid-row: 1",
  "place-items: center; place-content: center; border-collapse: collapse; border-spacing: 0",
  "table-layout: fixed; list-style-type: disc; list-style-position: inside",
];

for (const value of allowed) {
  test("safe style accepts " + value, () => {
    expect(safeStyleViolation(value)).toBeUndefined();
  });
}

for (const display of [
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "table",
  "table-row",
  "table-cell",
]) {
  test("safe style accepts display: " + display, () => {
    expect(safeStyleViolation("display: " + display)).toBeUndefined();
  });
}

const rejected = [
  ["position: fixed", "style property position is not allowed"],
  ["background-color: url(https://example.com/x)", "style URLs are not allowed"],
  ["color: red !important", "style !important is not allowed"],
  ["--x: red", "custom style properties are not allowed"],
  ["\\2d\\2dx: red", "custom style properties are not allowed"],
  ["c\\0olor: red", "style property c\uFFFDolor is not allowed"],
  ["color: var(--user-color)", "style variable is not allowed"],
  ["color: v\\61r(--user-color)", "style variable is not allowed"],
  ["color: red; color: blue", "style property color may only be specified once"],
  ["display: contents", "style display value contents is not allowed"],
  ["color: image(linear-gradient(red, blue))", "style function image is not allowed"],
  ["color: im\\61ge(red)", "style function image is not allowed"],
  ["color: var(--w-color-success, red)", "style variable is not allowed"],
  ["color: {", "style is invalid CSS"],
] as const;

for (const [value, expected] of rejected) {
  test("safe style rejects " + value, () => {
    expect(safeStyleViolation(value)).toBe(expected);
  });
}
