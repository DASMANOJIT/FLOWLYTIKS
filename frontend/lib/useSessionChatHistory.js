"use client";

import { useEffect, useRef, useState } from "react";

const trimMessages = (messages, maxMessages) => {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= maxMessages) return messages;
  return messages.slice(messages.length - maxMessages);
};

export default function useSessionChatHistory({
  storageKey,
  initialMessages,
  maxMessages = 50,
  sanitizeMessages,
}) {
  const initialMessagesRef = useRef(trimMessages(initialMessages, maxMessages));
  const loadedStorageKeyRef = useRef("");
  const [messages, setMessagesState] = useState(initialMessagesRef.current);

  useEffect(() => {
    initialMessagesRef.current = trimMessages(initialMessages, maxMessages);
  }, [initialMessages, maxMessages]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) {
      setMessagesState(initialMessagesRef.current);
      loadedStorageKeyRef.current = "";
      return;
    }

    try {
      const rawValue = window.sessionStorage.getItem(storageKey);
      if (!rawValue) {
        setMessagesState(initialMessagesRef.current);
        loadedStorageKeyRef.current = storageKey;
        return;
      }

      const parsedValue = JSON.parse(rawValue);
      if (!Array.isArray(parsedValue)) {
        window.sessionStorage.removeItem(storageKey);
        setMessagesState(initialMessagesRef.current);
        loadedStorageKeyRef.current = storageKey;
        return;
      }

      const nextMessages = sanitizeMessages
        ? sanitizeMessages(parsedValue)
        : parsedValue;

      if (!Array.isArray(nextMessages)) {
        window.sessionStorage.removeItem(storageKey);
        setMessagesState(initialMessagesRef.current);
        loadedStorageKeyRef.current = storageKey;
        return;
      }

      setMessagesState(trimMessages(nextMessages, maxMessages));
      loadedStorageKeyRef.current = storageKey;
    } catch {
      window.sessionStorage.removeItem(storageKey);
      setMessagesState(initialMessagesRef.current);
      loadedStorageKeyRef.current = storageKey;
    }
  }, [storageKey, maxMessages, sanitizeMessages]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !storageKey ||
      loadedStorageKeyRef.current !== storageKey
    ) {
      return;
    }

    try {
      const nextMessages = sanitizeMessages
        ? sanitizeMessages(messages)
        : messages;

      if (!Array.isArray(nextMessages)) {
        window.sessionStorage.removeItem(storageKey);
        return;
      }

      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify(trimMessages(nextMessages, maxMessages))
      );
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, [storageKey, messages, maxMessages, sanitizeMessages]);

  const setMessages = (nextValue) => {
    setMessagesState((currentMessages) => {
      const resolvedMessages =
        typeof nextValue === "function"
          ? nextValue(currentMessages)
          : nextValue;

      const sanitizedMessages = sanitizeMessages
        ? sanitizeMessages(resolvedMessages)
        : resolvedMessages;

      return trimMessages(
        Array.isArray(sanitizedMessages) ? sanitizedMessages : [],
        maxMessages
      );
    });
  };

  const clearMessages = () => {
    if (typeof window !== "undefined" && storageKey) {
      window.sessionStorage.removeItem(storageKey);
    }
    setMessagesState(initialMessagesRef.current);
  };

  return {
    messages,
    setMessages,
    clearMessages,
  };
}
