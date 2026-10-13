import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./overflow-status-text.css";

export function OverflowStatusText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => {
      const available = container.current?.clientWidth ?? 0;
      const required = content.current?.offsetWidth ?? 0;
      setWidth(available > 0 && required > available ? required : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span
      ref={container}
      className={`overflow-status-text ${className}${width ? " scrolling" : ""}`}
      title={text}
      aria-label={text}
      tabIndex={width ? 0 : undefined}
      style={
        {
          "--scroll-distance": `${width + 32}px`,
          "--scroll-duration": `${Math.max(10, (width + 32) / 40)}s`,
        } as CSSProperties
      }
    >
      <span className="overflow-status-track" aria-hidden="true">
        <span ref={content}>{text}</span>
        {width > 0 && <span>{text}</span>}
      </span>
    </span>
  );
}
