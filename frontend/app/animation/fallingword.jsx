"use client";

import { useEffect, useRef, useState } from "react";
import "./fallingword.css";

const wordList = [
  "Learn","Code","Develop","Design","Create","Innovate",
  "Build","Explore","Inspire","Achieve","Grow","Collaborate",
  "Imagine","Transform","Empower","Discover","Lead","Succeed"
];

const generateWords = () =>
  wordList.map((word) => ({
    word,
    left: `${Math.random() * 100}%`,
    duration: `${10 + Math.random() * 10}s`,
    delay: `${Math.random() * 5}s`,
  }));

export default function FallingWords() {
  const debugRenders = process.env.NEXT_PUBLIC_RENDER_DEBUG === "1";
  const renderCount = useRef(0);
  const warned = useRef(false);

  const [words, setWords] = useState([]);

  useEffect(() => {
    const id = setTimeout(() => {
      setWords(generateWords());
    }, 0);

    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!debugRenders) return;

    renderCount.current += 1;
    const c = renderCount.current;

    if (c === 1 || c === 2 || c === 3 || c === 5 || c === 10 || c === 20 || c % 50 === 0) {
      console.log("[render] falling-words", c);
    }

    if (!warned.current && c > 20) {
      warned.current = true;
      console.warn("⚠️ Excessive renders detected in FallingWords:", c);
    }
  });

  return (
    <div className="falling-layer">
      {words.map((w, i) => (
        <span
          key={i}
          className="falling-word"
          style={{
            left: w.left,
            animationDuration: w.duration,
            animationDelay: w.delay,
          }}
        >
          {w.word}
        </span>
      ))}
    </div>
  );
}
