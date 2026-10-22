import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import "./AppSelect.css";

export type MenuOption = { value: string; label: ReactNode; disabled: boolean };
export function menuOptions(children: ReactNode): MenuOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type !== "option") return menuOptions(child.props.children);
    return [
      {
        value: String(child.props.value ?? child.props.children ?? ""),
        label: child.props.children,
        disabled: !!child.props.disabled,
      },
    ];
  });
}

/** Visible menus belong to the application; the hidden select preserves form/change semantics. */
export function AppSelect({
  children,
  renderOption,
  icons,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  renderOption?: (option: MenuOption) => ReactNode;
  icons?: Record<string, ReactNode>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const options = menuOptions(children);
  const value = String(
    props.value ?? props.defaultValue ?? options[0]?.value ?? "",
  );
  const [localValue, setLocalValue] = useState(value);
  const selected = props.value === undefined ? localValue : value;
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [active, setActive] = useState(0);
  const search = useRef({ text: "", time: 0 });
  const close = (focus = false) => {
    setPosition(null);
    if (focus) trigger.current?.focus();
  };
  const open = () => {
    if (
      trigger.current?.matches(":disabled") ||
      !options.some((o) => !o.disabled)
    )
      return;
    const r = trigger.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const height = Math.min(
      300,
      options.length * 34 + 8,
      Math.max(below, above),
    );
    const width = Math.min(Math.max(r.width, 160), window.innerWidth - 16);
    setActive(
      Math.max(
        0,
        options.some((o) => o.value === selected && !o.disabled)
          ? options.findIndex((o) => o.value === selected && !o.disabled)
          : options.findIndex((o) => !o.disabled),
      ),
    );
    setPosition({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: below >= height ? r.bottom + 4 : Math.max(8, r.top - height - 4),
      width,
      maxHeight: height,
    });
  };
  useEffect(() => {
    if (!position) return;
    const away = (e: Event) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close();
    };
    const anchor = trigger.current?.getBoundingClientRect();
    const moved = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      const current = trigger.current?.getBoundingClientRect();
      // A scroll queued before opening must not dismiss an unchanged anchor.
      if (
        e.type === "resize" ||
        !anchor ||
        !current ||
        current.left !== anchor.left ||
        current.top !== anchor.top ||
        current.width !== anchor.width ||
        current.height !== anchor.height
      )
        close();
    };
    const observer = new MutationObserver(() => {
      if (trigger.current?.matches(":disabled")) close();
    });
    for (
      let node: HTMLElement | null = trigger.current;
      node;
      node = node.parentElement
    )
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["disabled", "inert"],
      });
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [position]);
  useEffect(() => {
    if (position) {
      const item = menu.current?.querySelector<HTMLButtonElement>(
        `[data-index="${active}"]`,
      );
      item?.focus({ preventScroll: true });
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [active, position]);
  function choose(option: MenuOption) {
    if (option.disabled || trigger.current?.matches(":disabled")) return;
    if (option.value !== selected && select.current) {
      select.current.value = option.value;
      setLocalValue(option.value);
      select.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close(true);
  }
  function move(direction: number) {
    for (let offset = 1; offset <= options.length; offset++) {
      const next =
        (active + offset * direction + options.length * offset) %
        options.length;
      if (!options[next].disabled) {
        setActive(next);
        break;
      }
    }
  }
  return (
    <span className="app-select">
      <button
        ref={trigger}
        type="button"
        id={props.id}
        className={props.className}
        style={props.style}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        title={props.title}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-haspopup="listbox"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => (position ? close() : open())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            open();
          }
        }}
      >
        <span>
          {icons?.[selected]}
          {options.find((o) => o.value === selected)?.label}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      <select
        {...props}
        id={undefined}
        autoFocus={false}
        className={undefined}
        style={{ display: "none" }}
        tabIndex={-1}
        aria-hidden="true"
        ref={select}
      >
        {children}
      </select>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={props["aria-label"] ?? "Choose an option"}
            className="app-select-menu"
            style={position}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              } else if (e.key === "Tab") {
                close(true);
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                move(e.key === "ArrowDown" ? 1 : -1);
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                const indices = options
                  .map((o, i) => (o.disabled ? -1 : i))
                  .filter((i) => i >= 0);
                setActive(
                  e.key === "Home" ? indices[0] : indices[indices.length - 1],
                );
              } else if (e.key.length === 1 && e.key !== " ") {
                const now = Date.now();
                search.current = {
                  text:
                    (now - search.current.time < 700
                      ? search.current.text
                      : "") + e.key.toLowerCase(),
                  time: now,
                };
                const index = options.findIndex(
                  (o) =>
                    !o.disabled &&
                    String(o.label)
                      .toLowerCase()
                      .startsWith(search.current.text),
                );
                if (index >= 0) setActive(index);
              }
            }}
          >
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === selected}
                disabled={o.disabled}
                data-index={i}
                tabIndex={active === i ? 0 : -1}
                onClick={() => choose(o)}
              >
                {icons?.[o.value]}
                {renderOption ? renderOption(o) : o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
