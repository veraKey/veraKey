import { defineConfig } from "tsup";

// Every module in src is an entry point (@verakey/sdk/<module>), so an app loads the prover only when it
// imports it. Code shared between modules goes into chunks, which keeps classes such as VeraKeyError one
// class across entry points. The circuit artifacts are inlined; dependencies stay external.
export default defineConfig({
  entry: ["src/*.ts"],
  format: ["esm"],
  target: "es2022",
  splitting: true,
  dts: true,
  clean: true,
  tsconfig: "tsconfig.build.json",
});
