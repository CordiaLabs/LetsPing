import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/vercel.ts", "src/langchain.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    external: ["ai", "@langchain/core", "zod", "@letsping/sdk"],
});