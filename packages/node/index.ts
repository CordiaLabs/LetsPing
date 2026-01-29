import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

// Types
export const StatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "TIMEOUT"]);
export type Status = z.infer<typeof StatusSchema>;

export interface LetsPingConfig {
    apiKey: string;
    baseUrl?: string;
}

export interface AskOptions {
    channel: string;
    payload: Record<string, any>;
    description?: string;
    timeoutSeconds?: number;
    blocking?: boolean;
    pollIntervalMs?: number;
}

export interface LetsPingResponse {
    id: string;
    status: Status;
    payload: Record<string, any>;
    resolvedAt?: string;
    metadata?: Record<string, any>;
}

export class LetsPing {
    private client: AxiosInstance;
    private pollInterval: number = 2000;

    constructor(config: LetsPingConfig) {
        if (!config.apiKey) {
            throw new Error("LetsPing API Key is required.");
        }

        this.client = axios.create({
            baseURL: config.baseUrl || "https://api.letsping.co/v1",
            headers: {
                "Authorization": `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
                "User-Agent": "letsping-node/0.1.0"
            }
        });
    }

    /**
     * Pauses execution and requests human approval.
     */
    async ask(options: AskOptions): Promise<LetsPingResponse> {
        try {
            // 1. Initialize Request
            const { data } = await this.client.post<LetsPingResponse>("/ask", {
                channel: options.channel,
                payload: options.payload,
                description: options.description || "Incoming AI Agent Request",
                timeout: options.timeoutSeconds || 3600
            });

            if (options.blocking === false) {
                return data;
            }

            // 2. Poll for Completion
            return this.poll(data.id, options.timeoutSeconds || 3600);

        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`LetsPing API Error: ${error.response?.data?.message || error.message}`);
            }
            throw error;
        }
    }

    private async poll(requestId: string, timeoutSeconds: number): Promise<LetsPingResponse> {
        const startTime = Date.now();
        const timeoutMs = timeoutSeconds * 1000;

        while (Date.now() - startTime < timeoutMs) {
            const { data } = await this.client.get<LetsPingResponse>(`/requests/${requestId}`);
            
            if (data.status !== "PENDING") {
                return data;
            }

            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }

        throw new Error("LetsPing Request Timed Out");
    }
}