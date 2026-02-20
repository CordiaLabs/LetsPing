#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LetsPing, Priority } from "@letsping/sdk";

// Ensure API Key is present
const apiKey = process.env.LETSPING_API_KEY;
if (!apiKey) {
    console.error("Error: LETSPING_API_KEY environment variable is required.");
    process.exit(1);
}

// Initialize LetsPing SDK
const lp = new LetsPing(apiKey);

// Create MCP Server
const server = new McpServer({
    name: "letsping",
    version: "0.1.2"
});

// Define 'ask_human' Tool
server.tool(
    "ask_human",
    "Request approval or a decision from a human operator. Use this when you need confirmation, authorization, or input before proceeding with a critical action.",
    {
        service: z.string().describe("The name of the service or agent requesting approval (e.g. 'billing-agent')"),
        action: z.string().describe("The specific action being requested (e.g. 'refund-user', 'deploy-prod')"),
        payload: z.record(z.any()).describe("Context data for the human to review. Can be an object with details."),
        priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Urgency of the request. Defaults to 'medium'."),
        timeout: z.number().optional().describe("Timeout in milliseconds. Defaults to 24 hours."),
        role: z.string().optional().describe("The team or role required for approval (e.g. 'finance', 'devops', 'legal').")
    },
    async ({ service, action, payload, priority, timeout, role }) => {
        try {
            console.error(`[LetsPing] Requesting human approval for ${service}:${action} (Role: ${role || "Any"})...`);

            const decision = await lp.ask({
                service,
                action,
                payload,
                priority: (priority as Priority) || "medium",
                timeoutMs: timeout,
                role
            });

            if (decision.status === "REJECTED") {
                return {
                    content: [{
                        type: "text",
                        text: `ACTION_REJECTED: The human operator rejected this action. Reason: ${decision.reason || "No reason provided."}`
                    }]
                };
            }

            // Approved
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(decision.patched_payload || decision.payload, null, 2)
                }]
            };

        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `ERROR: LetsPing request failed. ${error.message}`
                }],
                isError: true
            };
        }
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("LetsPing MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
