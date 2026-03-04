import { defineConfig } from "tsup";

export default defineConfig({
    entry: [
        "src/vercel.ts",
        "src/langchain.ts",
        "src/approval.ts",
        "src/cloudflare.ts",
        "src/cloudflare-observability.ts",
        "src/cloudflare-mcp.ts",
    ],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    external: ["ai", "@langchain/core", "zod", "@letsping/sdk", "node:diagnostics_channel"],
});