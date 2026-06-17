"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { getFacultyAuthToken } from "../../lib/authStorage.js";
import { readApiResponse } from "../../lib/api.js";

type ChatMessage = {
  id: string;
  role: "bot" | "user";
  text: string;
};

const quickPrompts = [
  "Mark today morning present 200",
  "What is my payout status?",
  "How to update payout details?",
  "How to change password?",
  "What day is today?",
  "Contact admin",
];

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "bot",
    text: "Hi, I am your Faculty Assistant. I can help with attendance, payout status, password guidance, payout details, and admin contact.",
  },
];

const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function FacultyChatbot() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text: string) => {
    const message = text.trim();
    if (!message || loading) return;

    const token = getFacultyAuthToken();
    if (!token) {
      setError("Please login again to use Faculty Assistant.");
      return;
    }

    setError("");
    setInput("");
    setMessages((current) => [...current, { id: newId(), role: "user", text: message }]);
    setLoading(true);

    try {
      const res = await fetch("/api/faculty/chatbot/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
      });
      const { ok, data, error: apiError } = await readApiResponse(res, "Assistant request failed. Please try again.");
      if (!ok) throw new Error(apiError);
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "bot",
          text: data?.reply || data?.message || "No response from Faculty Assistant.",
        },
      ]);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Assistant request failed. Please try again.";
      setError(messageText);
      setMessages((current) => [...current, { id: newId(), role: "bot", text: messageText }]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <section className="faculty-chatbot-panel faculty-chatbot-panel--page" aria-label="Faculty Assistant" aria-live="polite">
      <div className="faculty-chatbot-prompts">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => sendMessage(prompt)} disabled={loading}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="faculty-chatbot-messages" ref={messagesRef}>
        {messages.map((message) => (
          <div key={message.id} className={`faculty-chatbot-message faculty-chatbot-message--${message.role}`}>
            {message.text}
          </div>
        ))}
        {loading ? <div className="faculty-chatbot-message faculty-chatbot-message--bot">Thinking...</div> : null}
      </div>

      {error ? <div className="faculty-chatbot-error">{error}</div> : null}

      <form className="faculty-chatbot-input-row" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about attendance or payout..."
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Send message">
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}
