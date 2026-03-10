// Protocol types from @openduo/protocol

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ChannelIngressParams {
  session_key: string;
  text?: string;
  source_kind?: string;
  channel_id?: string;
  attachments?: Array<{ path: string; mime: string }>;
}

export interface ChannelPullParams {
  session_key: string;
  consumer_id: string;
  cursor?: string;
  limit?: number;
  wait_ms?: number;
  return_mask?: Array<"final" | "stream" | "tool">;
  channel_capabilities?: ChannelCapabilities;
}

export interface ChannelAckParams {
  session_key: string;
  consumer_id: string;
  cursor: string;
}

export interface ChannelCapabilities {
  outbound: {
    accept_mime: string[];
    max_bytes?: number;
  };
}

export interface OutboxRecord {
  id: string;
  session_key: string;
  payload: {
    text?: string;
    attachments?: Array<{ path: string; mime: string }>;
  };
  stream?: {
    stream_id: string;
    seq: number;
    is_final: boolean;
  };
  status: "pending" | "sent" | "failed";
}

export interface PullResult {
  records?: OutboxRecord[];
  next_cursor?: string;
  idle?: boolean;
}
