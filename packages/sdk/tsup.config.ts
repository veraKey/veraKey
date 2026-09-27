import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "tsup";

// Every module in src is an entry point (@verakey/sdk/<module>), so an app loads the prover only when it
// imports it. Code shared between modules goes into chunks, which keeps classes such as VeraKeyError one
// class across entry points. The circuit artifacts are inlined; dependencies (and React, a peer) stay external.
export default defineConfig({
  entry: ["src/*.ts"],
  format: ["esm"],
  target: "es2022",
  splitting: true,
  dts: true,
  clean: true,
  tsconfig: "tsconfig.build.json",
  // Next.js treats a module as client code only when the file starts with the directive, which bundling can drop.
  async onSuccess() {
    const file = "dist/react.js";
    const code = await readFile(file, "utf8");
    if (!code.startsWith('"use client"')) await writeFile(file, `"use client";\n${code}`);
  },
});
