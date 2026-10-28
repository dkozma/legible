import { describe, expect, it } from "vitest"

import { createResolver, goModulePath, includeDirsFrom } from "../src/resolve"

describe("module resolution", () => {
  it("Go: local only under a go.mod module, and exact below it", () => {
    const r = createResolver(
      [
        "go.mod",
        "config/config.go",
        "config/config_test.go",
        "lib/config/x.go",
      ],
      { goModules: new Map([[".", "example.com/app"]]) },
    )
    expect(r.resolve("go", "main.go", "example.com/app/config")).toEqual({
      files: ["config/config.go"],
      ambiguous: false,
    })
    expect(
      r.resolve("go", "main.go", "github.com/other/lib/config").files,
    ).toEqual([])
    expect(r.resolve("go", "main.go", "fmt").files).toEqual([])
  })

  it("Go: a nested module, and the old suffix rule without go.mod", () => {
    const nested = createResolver(["tools/gen/gen.go", "tools/go.mod"], {
      goModules: new Map([["tools", "example.com/tools"]]),
    })
    expect(nested.resolve("go", "x.go", "example.com/tools/gen").files).toEqual(
      ["tools/gen/gen.go"],
    )
    const bare = createResolver(["internal/audit/audit.go"])
    expect(
      bare.resolve("go", "x.go", "github.com/acme/app/internal/audit").files,
    ).toEqual(["internal/audit/audit.go"])
  })

  it("Python: the importing file's source root first; several elsewhere are ambiguous", () => {
    const r = createResolver([
      "src/shop/__init__.py",
      "src/shop/models.py",
      "src/shop/views.py",
      "tools/shop/models.py",
      "a/util.py",
      "b/util.py",
      "c/helpers.py",
    ])
    expect(r.resolve("python", "src/shop/views.py", "shop.models")).toEqual({
      files: ["src/shop/models.py"],
      ambiguous: false,
    })
    expect(r.resolve("python", "main.py", "util")).toEqual({
      files: ["a/util.py", "b/util.py"],
      ambiguous: true,
    })
    expect(r.resolve("python", "main.py", "helpers")).toEqual({
      files: ["c/helpers.py"],
      ambiguous: false,
    })
  })

  it("Java: source roots before suffixes, the importing module's own first", () => {
    const r = createResolver([
      "api/src/main/java/com/acme/Order.java",
      "core/src/main/java/com/acme/Order.java",
      "core/src/main/java/com/acme/Service.java",
      "core/src/main/java/com/acme/pay/Card.java",
      "legacy/x/com/acme/pay/Card.java",
    ])
    expect(
      r.resolve(
        "java",
        "core/src/main/java/com/acme/Service.java",
        "com.acme.Order",
      ),
    ).toEqual({
      files: ["core/src/main/java/com/acme/Order.java"],
      ambiguous: false,
    })
    expect(r.resolve("java", "web/Main.java", "com.acme.Order").ambiguous).toBe(
      true,
    )
    expect(r.resolve("java", "web/Main.java", "com.acme.pay.Card")).toEqual({
      files: ["core/src/main/java/com/acme/pay/Card.java"],
      ambiguous: false,
    })
  })

  it("C: relative first, then include directories, then ambiguous suffixes", () => {
    const r = createResolver(
      ["src/a.c", "src/util.h", "include/app/log.h", "x/log.h", "y/log.h"],
      { includeDirs: ["include"] },
    )
    expect(r.resolve("c", "src/a.c", "util.h").files).toEqual(["src/util.h"])
    expect(r.resolve("c", "src/a.c", "app/log.h").files).toEqual([
      "include/app/log.h",
    ])
    expect(r.resolve("c", "src/a.c", "log.h")).toMatchObject({
      ambiguous: true,
    })
    expect(r.resolve("c", "src/a.c", "stdio.h").files).toEqual([])
  })

  it("reads go.mod and compile_commands.json", () => {
    expect(goModulePath("// x\nmodule example.com/app\n\ngo 1.22\n")).toBe(
      "example.com/app",
    )
    expect(goModulePath("go 1.22\n")).toBeNull()
    expect(
      includeDirsFrom(
        [
          {
            directory: "/home/ci/repo/build",
            command:
              "cc -I../include -isystem /home/ci/repo/third_party/x -c a.c",
          },
          { directory: "/home/ci/repo", arguments: ["cc", "-I", "src/inc"] },
        ],
        new Set(["include", "third_party", "third_party/x", "src", "src/inc"]),
      ).toSorted(),
    ).toEqual(["include", "src/inc", "third_party/x"])
  })
})
