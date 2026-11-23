"use client";

import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";
import { type ReactNode, type RefObject, useId, useState } from "react";

export type FloatingNavbarItem = {
  href?: string;
  icon?: ReactNode;
  id: string;
  label: string;
  onSelect?: () => void;
};

export type FloatingNavbarProps = {
  actions?: ReactNode;
  activeId?: string;
  blur?: boolean;
  className?: string;
  containerRef?: RefObject<HTMLElement | null>;
  hideOnScroll?: boolean;
  items: FloatingNavbarItem[];
  logo?: ReactNode;
  onActiveChange?: (id: string) => void;
  position?: "top" | "bottom";
  scrollThreshold?: number;
};

const DEFAULT_SCROLL_THRESHOLD = 24;
const HIDE_DISTANCE = 16;
const NAV_SPRING = { bounce: 0.1, duration: 0.25, type: "spring" as const };
const HIDE_TRANSITION = {
  duration: 0.25,
  ease: [0.645, 0.045, 0.355, 1] as [number, number, number, number],
};

export default function FloatingNavbar({
  items,
  activeId: controlledActiveId,
  onActiveChange,
  logo,
  actions,
  hideOnScroll = true,
  scrollThreshold = DEFAULT_SCROLL_THRESHOLD,
  blur = true,
  position = "top",
  containerRef,
  className,
}: FloatingNavbarProps) {
  const shouldReduceMotion = useReducedMotion();
  const generatedId = useId();
  const pillLayoutId = `floating-navbar-pill-${generatedId}`;

  const [internalActiveId, setInternalActiveId] = useState(items[0]?.id ?? "");
  const [isHidden, setIsHidden] = useState(false);
  const [isShrunk, setIsShrunk] = useState(false);

  const isControlled = controlledActiveId !== undefined;
  const activeId = isControlled ? controlledActiveId : internalActiveId;

  const { scrollY } = useScroll(
    containerRef
      ? { container: containerRef as RefObject<HTMLElement> }
      : undefined
  );

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? latest;
    const delta = latest - previous;

    setIsShrunk(latest > scrollThreshold);

    if (!hideOnScroll || shouldReduceMotion || latest < scrollThreshold) {
      setIsHidden(false);
      return;
    }

    if (delta > 0) {
      setIsHidden(true);
    } else if (delta < 0) {
      setIsHidden(false);
    }
  });

  const handleSelect = (item: FloatingNavbarItem) => {
    if (!isControlled) {
      setInternalActiveId(item.id);
    }
    onActiveChange?.(item.id);
    item.onSelect?.();
  };

  const hiddenOffset = position === "top" ? -HIDE_DISTANCE : HIDE_DISTANCE;

  return (
    <motion.nav
      animate={
        shouldReduceMotion
          ? { opacity: isHidden ? 0 : 1, y: 0 }
          : { opacity: isHidden ? 0 : 1, y: isHidden ? hiddenOffset : 0 }
      }
      aria-label="Primary"
      className={["floating-nav", className].filter(Boolean).join(" ")}
      data-shrunk={isShrunk}
      data-blur={blur}
      data-position={position}
      onFocusCapture={() => setIsHidden(false)}
      initial={false}
      style={isHidden ? { pointerEvents: "none" } : undefined}
      transition={shouldReduceMotion ? { duration: 0 } : HIDE_TRANSITION}
    >
      {logo ? (
        <div className="flex shrink-0 items-center px-1">{logo}</div>
      ) : null}
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const isActive = item.id === activeId;
          const linkClassName = "float-item";
          return (
            <li className="relative" key={item.id}>
              {item.href ? (
                <a
                  aria-current={isActive ? "page" : undefined}
                  className={linkClassName}
                  href={item.href}
                  onClick={() => handleSelect(item)}
                >
                  {item.icon ? (
                    <span aria-hidden="true">{item.icon}</span>
                  ) : null}
                  {item.label}
                </a>
              ) : (
                <button
                  aria-current={isActive ? "page" : undefined}
                  className={linkClassName}
                  onClick={() => handleSelect(item)}
                  type="button"
                >
                  {item.icon ? (
                    <span aria-hidden="true">{item.icon}</span>
                  ) : null}
                  {item.label}
                </button>
              )}
              {isActive && (
                <motion.span
                  aria-hidden="true" className="float-indicator"
                  layoutId={pillLayoutId}
                  transition={shouldReduceMotion ? { duration: 0 } : NAV_SPRING}
                />
              )}
            </li>
          );
        })}
      </ul>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 pl-1">{actions}</div>
      ) : null}
    </motion.nav>
  );
}
