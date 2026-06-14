import type { ReactNode } from "react";

type Props = {
  role: "user" | "agent";
  content: string;
  variant?: "default" | "done";
};

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function ChatMessage({ role, content, variant = "default" }: Props) {
  const paragraphs = content.split("\n").filter((line) => line.trim().length > 0);

  return (
    <div
      className={`msg msg-${role}${variant === "done" ? " msg-done" : ""}`}
    >
      {paragraphs.map((line, i) => (
        <p key={i} className="chat-line">
          {renderInline(line)}
        </p>
      ))}
    </div>
  );
}
