import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "es2020",
  treeshake: true,
  splitting: false,
  minify: false,
  // Both peer deps stay external; consumers install them alongside.
  external: ["@feathq/web-sdk", "@openfeature/web-sdk", "@openfeature/core"],
});
