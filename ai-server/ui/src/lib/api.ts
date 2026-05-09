export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationMemory = {
  type: "conversation";
  user: string;
  assistant: string;
  timestamp: string;
};

export type DocumentMemory = {
  type: "document";
  content: string;
  summary: string;
  filename: string;
  chunkIndex: number;
  timestamp: string;
};

export type MemoryEntry = ConversationMemory | DocumentMemory;

export type StatusResponse = {
  status: string;
  qdrant: boolean;
  model: string;
};

export type ChatResponse = {
  reply: string;
  memoriesUsed: number;
};

export type UploadEvent =
  | { type: "start"; filename: string }
  | { type: "progress"; current: number; total: number }
  | { type: "done"; filename: string; chunks: number }
  | { type: "error"; message: string };

export async function getStatus(): Promise<StatusResponse> {
  const r = await fetch("/api/status");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function sendChat(
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getMemories(): Promise<MemoryEntry[]> {
  const r = await fetch("/api/memories");
  if (!r.ok) return [];
  return r.json();
}

export async function* uploadFile(
  file: File
): AsyncGenerator<UploadEvent> {
  const formData = new FormData();
  formData.append("file", file);

  const r = await fetch("/api/upload", { method: "POST", body: formData });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }

  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      yield JSON.parse(line.slice(6)) as UploadEvent;
    }
  }
}
