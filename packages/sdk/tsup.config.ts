import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts", "src/integrations/langgraph.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
});