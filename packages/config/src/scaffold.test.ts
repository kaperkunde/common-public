import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

import {
  TEMPLATE_NAMES,
  ScaffoldError,
  main,
  renderScaffold,
  scaffold,
  scaffoldVars,
} from "./scaffold"

const dir = () => mkdtempSync(join(tmpdir(), "kk-scaffold-"))

describe("scaffoldVars", () => {
  it("derives the defaults from the name", () => {
    expect(scaffoldVars("my-app")).toMatchObject({
      name: "my-app",
      name_upper: "MY_APP",
      db: "my_app",
      port: "3000",
    })
  })
  it("takes overrides of known variables only, and a slug name only", () => {
    expect(scaffoldVars("aj", { port: "4000" }).port).toBe("4000")
    expect(() => scaffoldVars("aj", { nope: "x" })).toThrow(
      /Unknown variable "nope"/,
    )
    expect(() => scaffoldVars("Not A Slug")).toThrow(ScaffoldError)
    expect(() => scaffoldVars("1app")).toThrow(ScaffoldError)
  })
})

describe("renderScaffold", () => {
  it("replaces variables and refuses unknown ones", () => {
    expect(renderScaffold("a {{x}} b {{ x }}", { x: "1" }, "t")).toBe("a 1 b 1")
    expect(() => renderScaffold("{{y}}", { x: "1" }, "t.yml")).toThrow(
      /t\.yml: unknown variable \{\{y\}\}/,
    )
  })
})

describe("scaffold", () => {
  it("writes every template with the name substituted and nothing left unrendered", () => {
    const out = dir()
    const result = scaffold({ name: "aj", out })
    expect(result.written.sort()).toEqual(
      [
        "deploy/Dockerfile",
        "deploy/entrypoint.sh",
        "deploy/hasura.Dockerfile",
        "docker-compose.coolify.yml",
      ].sort(),
    )
    for (const file of result.written) {
      const text = readFileSync(join(out, file), "utf8")
      expect(text, file).not.toMatch(/\{\{/)
      expect(text.toLowerCase(), file).not.toMatch(/campfire|lore/)
    }
    expect(statSync(join(out, "deploy/entrypoint.sh")).mode & 0o111).not.toBe(0)
  })

  it("renders a compose file that is valid YAML with the migrate gate between hasura and the app", () => {
    const out = dir()
    scaffold({
      name: "my-app",
      out,
      templates: ["compose"],
      vars: { port: "4000" },
    })
    const compose = parse(
      readFileSync(join(out, "docker-compose.coolify.yml"), "utf8"),
    ) as {
      services: Record<
        string,
        {
          depends_on?: Record<string, { condition: string }>
          expose?: string[]
          environment?: Record<string, string>
        }
      >
    }
    expect(Object.keys(compose.services)).toEqual([
      "postgres",
      "hasura",
      "migrate",
      "my-app",
    ])
    expect(compose.services.migrate!.depends_on!.hasura!.condition).toBe(
      "service_healthy",
    )
    expect(compose.services["my-app"]!.depends_on!.migrate!.condition).toBe(
      "service_completed_successfully",
    )
    expect(compose.services["my-app"]!.expose).toEqual(["4000"])
    expect(compose.services["my-app"]!.environment!.BETTER_AUTH_URL).toBe(
      "${SERVICE_URL_MY_APP}",
    )
    expect(
      compose.services.hasura!.environment!.HASURA_GRAPHQL_CORS_DOMAIN,
    ).toBe("${MY_APP_ORIGIN:-${SERVICE_URL_MY_APP}}")
    expect(compose.services.postgres!.environment!.POSTGRES_DB).toBe("my_app")
  })

  it("puts the app's own settings in the Dockerfile and entrypoint", () => {
    const out = dir()
    scaffold({
      name: "aj",
      out,
      vars: {
        node_version: "24.0.0",
        auth_config: "lib/auth.ts",
        auth_dir: "lib",
      },
    })
    const docker = readFileSync(join(out, "deploy/Dockerfile"), "utf8")
    expect(docker).toContain("FROM node:24.0.0-alpine AS build")
    expect(docker).toContain("/app/lib ./lib")
    expect(readFileSync(join(out, "deploy/entrypoint.sh"), "utf8")).toContain(
      "--config lib/auth.ts",
    )
    expect(readFileSync(join(out, "deploy/entrypoint.sh"), "utf8")).toContain(
      '-p "${PORT:-3000}"',
    )
  })

  it("skips files that exist unless forced", () => {
    const out = dir()
    scaffold({ name: "aj", out, templates: ["dockerfile"] })
    writeFileSync(join(out, "deploy/Dockerfile"), "mine")
    expect(scaffold({ name: "aj", out, templates: ["dockerfile"] })).toEqual({
      written: [],
      skipped: ["deploy/Dockerfile"],
    })
    expect(readFileSync(join(out, "deploy/Dockerfile"), "utf8")).toBe("mine")
    scaffold({ name: "aj", out, templates: ["dockerfile"], force: true })
    expect(readFileSync(join(out, "deploy/Dockerfile"), "utf8")).toContain(
      "FROM node:",
    )
  })

  it("refuses an unknown template", () => {
    expect(() =>
      scaffold({ name: "aj", out: dir(), templates: ["nope" as never] }),
    ).toThrow(/Unknown template/)
  })

  it("lists its templates", () => {
    expect(TEMPLATE_NAMES).toEqual([
      "dockerfile",
      "hasura-dockerfile",
      "entrypoint",
      "compose",
    ])
  })
})

describe("kk-scaffold", () => {
  const run = (argv: string[]) => {
    const lines: string[] = []
    return { code: main(argv, (l) => lines.push(l)), lines }
  }
  it("scaffolds, reports and honours --set, --force and template names", () => {
    const out = dir()
    const first = run([
      "--name",
      "aj",
      "--out",
      out,
      "compose",
      "--set",
      "port=4001",
    ])
    expect(first).toMatchObject({
      code: 0,
      lines: ["wrote docker-compose.coolify.yml"],
    })
    expect(
      readFileSync(join(out, "docker-compose.coolify.yml"), "utf8"),
    ).toContain('"4001"')
    expect(run(["--name", "aj", "--out", out, "compose"]).lines).toEqual([
      "skipped docker-compose.coolify.yml (exists; use --force)",
    ])
    expect(
      run(["--name", "aj", "--out", out, "all", "--force"]).lines,
    ).toHaveLength(4)
    expect(existsSync(join(out, "deploy/hasura.Dockerfile"))).toBe(true)
  })
  it("answers usage errors with exit 2 and help with 0", () => {
    expect(run([]).code).toBe(2)
    expect(run(["--name", "Bad Name"]).code).toBe(2)
    expect(run(["--name", "aj", "--bogus"]).code).toBe(2)
    expect(run(["--name", "aj", "--set", "novalue"]).code).toBe(2)
    expect(run(["--help"]).code).toBe(0)
  })
})
