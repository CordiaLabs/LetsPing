export type OpenClawChannel = {
    id: string;
    secret_hash: string;
    push_subscription: any | null;
    label: string;
    last_active_at: string;
    created_at: string;
};

export type OpenClawRequest = {
    id: string;
    channel_id: string;
    tool_name: string;
    risk_reason: string | null;
    original_payload: Record<string, any>;
    patched_payload: Record<string, any> | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    created_at: string;
    resolved_at: string | null;
};