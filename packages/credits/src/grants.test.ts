import { describe, expect, it } from "vitest"
import {
  balanceLine,
  grantAfter,
  grantLine,
  grantProblem,
  isCorrection,
  parseGrantAmount,
  signedCreditsText,
  whoOf,
  whoText,
} from "./grants"

describe("whoOf", () => {
  it("reads an address as one, in the shape every address is compared in", () => {
    expect(whoOf("  Keeper@Example.com ")).toEqual({
      email: "keeper@example.com",
    })
  })

  it("reads anything else as a display name, as typed", () => {
    expect(whoOf(" Ash of the Pass ")).toEqual({ name: "Ash of the Pass" })
    expect(whoOf("ash@home")).toEqual({ name: "ash@home" })
  })

  it("reads nothing as nobody", () => {
    expect(whoOf("   ")).toBeUndefined()
  })

  it("names whoever it was in a refusal", () => {
    expect(whoText({ email: "a@b.co" })).toBe("a@b.co")
    expect(whoText({ name: "Ash" })).toBe("Ash")
  })
})

describe("parseGrantAmount", () => {
  it("takes a whole number either side of zero, however the thousands are written", () => {
    expect(parseGrantAmount("1200")).toBe(1200)
    expect(parseGrantAmount("1,200")).toBe(1200)
    expect(parseGrantAmount(" 1 000 000 ")).toBe(1000000)
    expect(parseGrantAmount("-5_000")).toBe(-5000)
    expect(parseGrantAmount("−5000")).toBe(-5000)
    expect(parseGrantAmount("+30")).toBe(30)
    expect(parseGrantAmount(-7)).toBe(-7)
  })

  it("refuses zero, a fraction and words", () => {
    expect(parseGrantAmount("0")).toBeUndefined()
    expect(parseGrantAmount("-0")).toBeUndefined()
    expect(parseGrantAmount("1.5")).toBeUndefined()
    expect(parseGrantAmount("lots")).toBeUndefined()
    expect(parseGrantAmount("")).toBeUndefined()
    expect(parseGrantAmount("99999999999999999999")).toBeUndefined()
  })
})

describe("grantAfter", () => {
  it("adds a grant to what was bought", () => {
    expect(grantAfter(0, 1200)).toBe(1200)
  })

  it("takes a correction from it, down to nothing and no further", () => {
    expect(grantAfter(1200, -1200)).toBe(0)
    expect(grantAfter(1200, -5000)).toBeUndefined()
  })
})

describe("the words", () => {
  it("tells a grant from a correction", () => {
    expect(isCorrection(-1)).toBe(true)
    expect(isCorrection(1)).toBe(false)
    expect(grantLine(1200, " a playtest ")).toBe(
      "Granted by the admin: a playtest",
    )
    expect(grantLine(-300, "counted twice")).toBe(
      "Corrected by the admin: counted twice",
    )
  })

  it("signs the amount", () => {
    expect(signedCreditsText(1200)).toBe("+1,200 credits")
    expect(signedCreditsText(-1, { one: "lore token", many: "lore tokens" })).toBe(
      "-1 lore token",
    )
  })

  it("says a balance found in a line", () => {
    expect(balanceLine("Ash", { free: 300, purchased: 1200 })).toBe(
      "Ash has 1,200 bought credits and 300 free.",
    )
    expect(balanceLine("Bo", { free: 0, purchased: 1 })).toBe(
      "Bo has 1 bought credit and 0 free.",
    )
  })

  it("says what stands in the way of the form, one thing at a time", () => {
    expect(grantProblem({ who: "", amount: "5", reason: "x" })).toMatch(
      /^Say who/,
    )
    expect(grantProblem({ who: "Ash", amount: "0", reason: "x" })).toMatch(
      /^An amount/,
    )
    expect(grantProblem({ who: "Ash", amount: "-5", reason: " " })).toMatch(
      /^A grant needs a reason/,
    )
    expect(
      grantProblem({ who: "Ash", amount: "-5", reason: "counted twice" }),
    ).toBeUndefined()
  })
})
