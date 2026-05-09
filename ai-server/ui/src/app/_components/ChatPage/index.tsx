"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatMessage,
  type MemoryEntry,
  type StatusResponse,
  getMemories,
  getStatus,
  sendChat,
  uploadFile,
} from "@/lib/api";

type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  memoriesUsed?: number;
  isLoading?: boolean;
  isError?: boolean;
};

export function ChatPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "こんにちは！何でも聞いてください。ファイルをアップロードすると、その内容も参考にして答えます。",
    },
  ]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [uploadStatus, setUploadStatus] = useState<{
    filename: string;
    current: number;
    total: number;
    done: boolean;
    error?: string;
  } | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<
    { filename: string; chunks: number }[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    refreshMemories();
  }, []);

  const refreshMemories = useCallback(async () => {
    const mems = await getMemories().catch(() => []);
    setMemories(mems);
  }, []);

  const handleSend = useCallback(async () => {
    const message = input.trim();
    if (!message || isLoading) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };
    const loadingId = crypto.randomUUID();
    const loadingMsg: DisplayMessage = {
      id: loadingId,
      role: "assistant",
      content: "",
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setIsLoading(true);

    try {
      const result = await sendChat(message, history);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                id: loadingId,
                role: "assistant",
                content: result.reply,
                memoriesUsed: result.memoriesUsed,
              }
            : m
        )
      );
      setHistory((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      ]);
      refreshMemories();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                id: loadingId,
                role: "assistant",
                content: `エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, history, refreshMemories]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFileChange = useCallback(
    async (file: File) => {
      setUploadStatus({ filename: file.name, current: 0, total: 0, done: false });
      try {
        for await (const event of uploadFile(file)) {
          if (event.type === "start") {
            setUploadStatus({ filename: file.name, current: 0, total: 0, done: false });
          } else if (event.type === "progress") {
            setUploadStatus({
              filename: file.name,
              current: event.current,
              total: event.total,
              done: false,
            });
          } else if (event.type === "done") {
            setUploadStatus({
              filename: event.filename,
              current: event.chunks,
              total: event.chunks,
              done: true,
            });
            setUploadedFiles((prev) => [
              ...prev,
              { filename: event.filename, chunks: event.chunks },
            ]);
            refreshMemories();
          } else if (event.type === "error") {
            setUploadStatus((prev) =>
              prev ? { ...prev, error: event.message } : null
            );
          }
        }
      } catch (err) {
        setUploadStatus((prev) =>
          prev
            ? {
                ...prev,
                error: err instanceof Error ? err.message : String(err),
              }
            : null
        );
      }
    },
    [refreshMemories]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileChange(file);
    },
    [handleFileChange]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "会話をリセットしました。",
      },
    ]);
  }, []);

  const progressPct =
    uploadStatus && uploadStatus.total > 0
      ? Math.round((uploadStatus.current / uploadStatus.total) * 100)
      : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <span className="text-2xl">🤖</span>
        <h1 className="font-semibold text-lg">StackChan Chat</h1>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-xs text-slate-400">
            {status === null
              ? "接続中..."
              : status.qdrant
                ? "🟢 Qdrant 接続済み"
                : "🟡 記憶なし"}
          </span>
          {status && (
            <span className="text-xs text-slate-500">{status.model}</span>
          )}
          <button
            onClick={clearHistory}
            className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 rounded px-2 py-1 transition-colors"
          >
            リセット
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 flex-shrink-0 bg-slate-800 border-r border-slate-700 flex flex-col overflow-hidden">
          {/* File upload */}
          <div className="p-4 border-b border-slate-700">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              ファイル登録
            </h2>
            <label
              className="block border-2 border-dashed border-slate-600 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                type="file"
                className="hidden"
                accept=".txt,.md,.csv,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileChange(file);
                  e.target.value = "";
                }}
              />
              <div className="text-slate-400 text-sm">
                <div className="text-2xl mb-1">📄</div>
                <div>クリックまたはドラッグ&amp;ドロップ</div>
                <div className="text-xs mt-1 text-slate-500">
                  .txt .md .csv .json
                </div>
              </div>
            </label>

            {/* Upload progress */}
            {uploadStatus && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span className="truncate flex-1">{uploadStatus.filename}</span>
                  {!uploadStatus.error && (
                    <span className="ml-2 flex-shrink-0">
                      {uploadStatus.done ? "✅" : `${progressPct}%`}
                    </span>
                  )}
                </div>
                {!uploadStatus.error ? (
                  <div className="w-full bg-slate-700 rounded-full h-1">
                    <div
                      className="bg-blue-500 h-1 rounded-full transition-all duration-300"
                      style={{ width: `${uploadStatus.done ? 100 : progressPct}%` }}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-red-400">❌ {uploadStatus.error}</p>
                )}
                {uploadStatus.total > 0 && !uploadStatus.error && (
                  <p className="text-xs text-slate-500 mt-1">
                    {uploadStatus.done
                      ? `${uploadStatus.total}チャンクを保存しました`
                      : `${uploadStatus.current}/${uploadStatus.total} チャンク処理中`}
                  </p>
                )}
              </div>
            )}

            {/* Uploaded files */}
            {uploadedFiles.length > 0 && (
              <div className="mt-3 space-y-1">
                {uploadedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-slate-300 bg-slate-700/50 rounded px-2 py-1.5"
                  >
                    <span>📄</span>
                    <span className="truncate flex-1">{f.filename}</span>
                    <span className="text-slate-500 flex-shrink-0">
                      {f.chunks}ch
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Memory list */}
          <div className="flex-1 overflow-hidden flex flex-col p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                記憶{" "}
                <span className="text-slate-600 font-normal normal-case">
                  ({memories.length})
                </span>
              </h2>
              <button
                onClick={refreshMemories}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                更新
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 text-xs">
              {memories.length === 0 ? (
                <p className="text-slate-600 text-center py-6">
                  まだ記憶がありません
                </p>
              ) : (
                memories.map((m, i) =>
                  m.type === "document" ? (
                    <div key={i} className="bg-slate-700/50 rounded-lg p-2 space-y-0.5">
                      <div className="text-blue-400 font-medium truncate">
                        📄 {m.filename}
                      </div>
                      <div className="text-slate-400 line-clamp-2">
                        {m.summary || m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="bg-slate-700/50 rounded-lg p-2 space-y-0.5">
                      <div className="text-green-400 truncate">
                        💬 {m.user.slice(0, 50)}
                      </div>
                      <div className="text-slate-400 line-clamp-2">
                        {m.assistant.slice(0, 80)}
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          </div>
        </aside>

        {/* Chat area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[75%]">
                  <div
                    className={[
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : msg.isError
                          ? "bg-red-900/40 text-red-200 rounded-bl-sm"
                          : "bg-slate-700 text-slate-100 rounded-bl-sm",
                    ].join(" ")}
                  >
                    {msg.isLoading ? (
                      <span className="flex items-center gap-1.5">
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </span>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {(msg.memoriesUsed ?? 0) > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      📎 {msg.memoriesUsed}件の記憶を参照
                    </p>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 bg-slate-800 border-t border-slate-700">
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 160) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力... (Enter で送信、Shift+Enter で改行)"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 placeholder-slate-500 resize-none leading-relaxed"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-5 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
              >
                送信
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
