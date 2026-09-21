export interface ChatMessage {
  id: string;
  type: "user" | "bot";
  message?: string;
  images?: string[];
  // Keep the actual request attachments, including inherited label context.
  attachments?: File[];
  replyTo?: string;
  timestamp: Date;
  isProcessing?: boolean;
  isError?: boolean;
}

export function buildHistoryPayload(messages: ChatMessage[]) {
  const usable = messages
    .filter((m) => m.message && !m.isProcessing && !m.isError && (m.type === "user" || m.replyTo))
    .slice(-8)
    .map((m) => ({ role: m.type === "user" ? "user" : "model", text: m.message! }));
  const firstUser = usable.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : usable.slice(firstUser);
}

// A replay must use history BEFORE the selected question, never later answers.
export function prepareReplay(messages: ChatMessage[], questionId: string) {
  const index = messages.findIndex((m) => m.id === questionId && m.type === "user");
  if (index < 0 || !messages[index].attachments?.length) return null;
  return { history: messages.slice(0, index), question: messages[index] };
}
