import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useRef,
  useState
} from "react";

export type ViewPreset = "simple" | "advanced";
export type FocusPanel = "none" | "publish" | "history";
export type DraggingColumn = "none" | "left" | "right";

const MIN_LEFT_COLUMN_RATIO = 0.3;
const MIN_MIDDLE_COLUMN_RATIO = 0.22;
const MIN_HISTORY_COLUMN_RATIO = 0.24;

interface WorkspaceLayoutState {
  viewPreset: ViewPreset;
  setViewPreset: Dispatch<SetStateAction<ViewPreset>>;
  connectionsCollapsed: boolean;
  setConnectionsCollapsed: Dispatch<SetStateAction<boolean>>;
  publishCollapsed: boolean;
  setPublishCollapsed: Dispatch<SetStateAction<boolean>>;
  historyCollapsed: boolean;
  setHistoryCollapsed: Dispatch<SetStateAction<boolean>>;
  focusPanel: FocusPanel;
  setFocusPanel: Dispatch<SetStateAction<FocusPanel>>;
  payloadSplit: number;
  setDraggingSplit: Dispatch<SetStateAction<boolean>>;
  draggingSplit: boolean;
  setDraggingColumn: Dispatch<SetStateAction<DraggingColumn>>;
  draggingColumn: DraggingColumn;
  middleColumnRef: MutableRefObject<HTMLDivElement | null>;
  mainGridRef: MutableRefObject<HTMLElement | null>;
  middleColumnRows: string;
  showLeftResizer: boolean;
  showRightResizer: boolean;
  mainGridTemplate: string | undefined;
}

function readBooleanPreference(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  return fallback;
}

export function useWorkspaceLayout(): WorkspaceLayoutState {
  const [viewPreset, setViewPreset] = useState<ViewPreset>(() => {
    if (typeof window === "undefined") {
      return "simple";
    }
    const saved = window.localStorage.getItem("mqtt-rover.view-preset");
    return saved === "advanced" ? "advanced" : "simple";
  });
  const [connectionsCollapsed, setConnectionsCollapsed] = useState(() =>
    readBooleanPreference("mqtt-rover.panel.connections-collapsed", true)
  );
  const [publishCollapsed, setPublishCollapsed] = useState(() =>
    readBooleanPreference("mqtt-rover.panel.publish-collapsed", true)
  );
  const [historyCollapsed, setHistoryCollapsed] = useState(() =>
    readBooleanPreference("mqtt-rover.panel.history-collapsed", true)
  );
  const [focusPanel, setFocusPanel] = useState<FocusPanel>("none");
  const [payloadSplit, setPayloadSplit] = useState(0.66);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1600
  );
  const [leftColumnRatio, setLeftColumnRatio] = useState(() => {
    if (typeof window === "undefined") return 0.46;
    const saved = Number(window.localStorage.getItem("mqtt-rover.layout.left-ratio"));
    return Number.isFinite(saved) && saved >= 0.3 && saved <= 0.7 ? saved : 0.46;
  });
  const [middleColumnRatio, setMiddleColumnRatio] = useState(() => {
    if (typeof window === "undefined") return 0.3;
    const saved = Number(window.localStorage.getItem("mqtt-rover.layout.middle-ratio"));
    return Number.isFinite(saved) && saved >= 0.22 && saved <= 0.55 ? saved : 0.3;
  });
  const [draggingColumn, setDraggingColumn] = useState<DraggingColumn>("none");
  const middleColumnRef = useRef<HTMLDivElement | null>(null);
  const mainGridRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("mqtt-rover.layout.left-ratio", String(leftColumnRatio));
  }, [leftColumnRatio]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("mqtt-rover.layout.middle-ratio", String(middleColumnRatio));
  }, [middleColumnRatio]);

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("mqtt-rover.view-preset", viewPreset);
    if (viewPreset === "simple") {
      setConnectionsCollapsed(true);
      setFocusPanel("none");
    }
  }, [viewPreset]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "mqtt-rover.panel.connections-collapsed",
      connectionsCollapsed ? "1" : "0"
    );
  }, [connectionsCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "mqtt-rover.panel.publish-collapsed",
      publishCollapsed ? "1" : "0"
    );
  }, [publishCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "mqtt-rover.panel.history-collapsed",
      historyCollapsed ? "1" : "0"
    );
  }, [historyCollapsed]);

  useEffect(() => {
    if (publishCollapsed && focusPanel === "publish") {
      setFocusPanel("none");
    }
  }, [publishCollapsed, focusPanel]);

  useEffect(() => {
    if (historyCollapsed && focusPanel === "history") {
      setFocusPanel("none");
    }
  }, [historyCollapsed, focusPanel]);

  useEffect(() => {
    if (!draggingSplit) {
      return;
    }

    const onMove = (event: MouseEvent) => {
      const node = middleColumnRef.current;
      if (!node) {
        return;
      }
      const bounds = node.getBoundingClientRect();
      if (bounds.height <= 0) {
        return;
      }
      const raw = (event.clientY - bounds.top) / bounds.height;
      const clamped = Math.min(0.84, Math.max(0.38, raw));
      setPayloadSplit(clamped);
    };

    const onUp = () => {
      setDraggingSplit(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingSplit]);

  useEffect(() => {
    if (draggingColumn === "none") {
      return;
    }

    const onMove = (event: MouseEvent) => {
      const node = mainGridRef.current;
      if (!node) {
        return;
      }
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0) {
        return;
      }
      const xRatio = (event.clientX - bounds.left) / bounds.width;

      if (draggingColumn === "left") {
        let nextLeft = Math.max(MIN_LEFT_COLUMN_RATIO, Math.min(0.7, xRatio));
        const currentVisibleLeft = Math.min(
          leftColumnRatio,
          1 - MIN_MIDDLE_COLUMN_RATIO - MIN_HISTORY_COLUMN_RATIO
        );
        const visibleMiddle = Math.max(
          MIN_MIDDLE_COLUMN_RATIO,
          Math.min(
            middleColumnRatio,
            1 - currentVisibleLeft - MIN_HISTORY_COLUMN_RATIO
          )
        );
        const maxLeft = historyCollapsed
          ? 1 - MIN_MIDDLE_COLUMN_RATIO
          : 1 - visibleMiddle - MIN_HISTORY_COLUMN_RATIO;
        nextLeft = Math.min(nextLeft, maxLeft);
        setLeftColumnRatio(nextLeft);
      } else if (draggingColumn === "right") {
        if (historyCollapsed) {
          return;
        }
        let nextMiddle = xRatio - leftColumnRatio;
        const maxMiddle = 1 - leftColumnRatio - MIN_HISTORY_COLUMN_RATIO;
        nextMiddle = Math.max(
          MIN_MIDDLE_COLUMN_RATIO,
          Math.min(maxMiddle, nextMiddle)
        );
        setMiddleColumnRatio(nextMiddle);
      }
    };

    const onUp = () => {
      setDraggingColumn("none");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingColumn, historyCollapsed, leftColumnRatio, middleColumnRatio]);

  const middleColumnRows =
    focusPanel === "publish"
      ? "1fr"
      : publishCollapsed
        ? "1fr"
        : `${payloadSplit}fr 10px ${1 - payloadSplit}fr`;

  const showLeftResizer = focusPanel === "none" && viewportWidth > 1080;
  const showRightResizer = showLeftResizer && !historyCollapsed;
  const visibleLeftColumnRatio = historyCollapsed
    ? leftColumnRatio
    : Math.min(
        leftColumnRatio,
        1 - MIN_MIDDLE_COLUMN_RATIO - MIN_HISTORY_COLUMN_RATIO
      );
  const visibleMiddleColumnRatio = historyCollapsed
    ? middleColumnRatio
    : Math.max(
        MIN_MIDDLE_COLUMN_RATIO,
        Math.min(
          middleColumnRatio,
          1 - visibleLeftColumnRatio - MIN_HISTORY_COLUMN_RATIO
        )
      );
  const rightColumnRatio = Math.max(
    MIN_HISTORY_COLUMN_RATIO,
    1 - visibleLeftColumnRatio - visibleMiddleColumnRatio
  );
  const mainGridTemplate = showLeftResizer
    ? historyCollapsed
      ? `${leftColumnRatio}fr 10px ${1 - leftColumnRatio}fr`
      : `${visibleLeftColumnRatio}fr 10px ${visibleMiddleColumnRatio}fr 10px ${rightColumnRatio}fr`
    : undefined;

  return {
    viewPreset,
    setViewPreset,
    connectionsCollapsed,
    setConnectionsCollapsed,
    publishCollapsed,
    setPublishCollapsed,
    historyCollapsed,
    setHistoryCollapsed,
    focusPanel,
    setFocusPanel,
    payloadSplit,
    setDraggingSplit,
    draggingSplit,
    setDraggingColumn,
    draggingColumn,
    middleColumnRef,
    mainGridRef,
    middleColumnRows,
    showLeftResizer,
    showRightResizer,
    mainGridTemplate
  };
}
