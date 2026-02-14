import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

interface VirtualResult<T> {
  containerRef: RefObject<HTMLDivElement | null>;
  visibleItems: Array<{ item: T; index: number }>;
  topPadding: number;
  bottomPadding: number;
}

export function useVirtualRows<T>(rows: T[], rowHeight = 28): VirtualResult<T> {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(element);

    const onScroll = () => {
      setScrollTop(element.scrollTop);
    };

    element.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  return useMemo(() => {
    const total = rows.length;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 10);
    const capacity = Math.ceil(height / rowHeight) + 20;
    const end = Math.min(total, start + capacity);

    const visibleItems = rows.slice(start, end).map((item, offset) => ({
      item,
      index: start + offset
    }));

    return {
      containerRef,
      visibleItems,
      topPadding: start * rowHeight,
      bottomPadding: (total - end) * rowHeight
    };
  }, [height, rowHeight, rows, scrollTop]);
}
