import { useEffect, useState } from 'react';

interface TypewriterTextProps {
  text: string;
  speed?: number;
  delay?: number;
  className?: string;
  cursor?: boolean;
}

export function TypewriterText({
  text,
  speed = 24,
  delay = 50,
  className = '',
  cursor = true,
}: TypewriterTextProps) {
  const [displayed, setDisplayed] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayed(text);
      setIsTyping(false);
      return;
    }
    let timeoutId: number;
    let intervalId: number;
    let currentIdx = 0;

    setDisplayed('');
    setIsTyping(true);

    timeoutId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        if (currentIdx < text.length) {
          setDisplayed(text.slice(0, currentIdx + 1));
          currentIdx++;
        } else {
          setIsTyping(false);
          window.clearInterval(intervalId);
        }
      }, speed);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [text, speed, delay]);

  return (
    <span className={`typewriter-container ${className}`}>
      <span>{displayed}</span>
      {cursor && isTyping && <span className="typewriter-cursor">|</span>}
    </span>
  );
}
