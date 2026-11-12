import { describe, expect, it } from "vitest"

import { renderTemplate, TemplateError } from "./template"

const declared = new Set(["prefix", "schema"])

describe("renderTemplate", () => {
  it("replaces placeholders, with or without inner spaces", () => {
    expect(
      renderTemplate(
        "create table {{schema}}.{{ prefix }}x ();",
        declared,
        { schema: "public", prefix: "c_" },
        "t",
      ),
    ).toBe("create table public.c_x ();")
  })

  it("replaces every occurrence", () => {
    expect(
      renderTemplate("{{prefix}}{{prefix}}", declared, { prefix: "a" }, "t"),
    ).toBe("aa")
  })

  it("errors on an undeclared variable, naming where", () => {
    expect(() => renderTemplate("{{nope}}", declared, {}, "up.sql")).toThrow(
      /up\.sql: unknown variable \{\{nope\}\}/,
    )
  })

  it("errors on a declared variable with no value", () => {
    expect(() => renderTemplate("{{prefix}}", declared, {}, "x")).toThrow(
      /has no value/,
    )
  })

  it("errors on a malformed placeholder", () => {
    expect(() =>
      renderTemplate("a\n{{ not valid }}", declared, {}, "x"),
    ).toThrow(/malformed placeholder on line 2/)
    expect(() => renderTemplate("{{", declared, {}, "x")).toThrow(TemplateError)
  })

  it("leaves text without placeholders alone", () => {
    expect(renderTemplate("select '{x}';", declared, {}, "x")).toBe(
      "select '{x}';",
    )
  })
})
