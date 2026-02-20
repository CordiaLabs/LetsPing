import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs"],
    clean: true,
    minify: true,
    dts: false,
    sourcemap: false,
    splitting: false,
    treeshake: true,
});