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
  const [leftColumnRatio, setLeftColumnRatio] = useState(0.4);
  const [middleColumnRatio, setMiddleColumnRatio] = useState(0.42);
  const [draggingColumn, setDraggingColumn] = useState<DraggingColumn>("none");
  const middleColumnRef = useRef<HTMLDivElement | null>(null);
  const mainGridRef = useRef<HTMLElement | null>(null);

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

    const leftMin = 0.2;
    const middleMin = 0.22;
    const rightMin = 0.18;

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
        let nextLeft = Math.max(leftMin, Math.min(0.7, xRatio));
        const maxLeft = historyCollapsed
          ? 1 - middleMin
          : 1 - middleColumnRatio - rightMin;
        nextLeft = Math.min(nextLeft, maxLeft);
        setLeftColumnRatio(nextLeft);
      } else if (draggingColumn === "right") {
        if (historyCollapsed) {
          return;
        }
        let nextMiddle = xRatio - leftColumnRatio;
        const maxMiddle = 1 - leftColumnRatio - rightMin;
        nextMiddle = Math.max(middleMin, Math.min(maxMiddle, nextMiddle));
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

  const showLeftResizer = focusPanel === "none" && viewportWidth > 1400;
  const showRightResizer = showLeftResizer && !historyCollapsed;
  const rightColumnRatio = Math.max(0.18, 1 - leftColumnRatio - middleColumnRatio);
  const mainGridTemplate = showLeftResizer
    ? historyCollapsed
      ? `${leftColumnRatio}fr 10px ${1 - leftColumnRatio}fr`
      : `${leftColumnRatio}fr 10px ${middleColumnRatio}fr 10px ${rightColumnRatio}fr`
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
