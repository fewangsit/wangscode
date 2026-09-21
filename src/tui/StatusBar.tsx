import { useSyncExternalStore } from "react";

import { capitalize } from "./format.ts";
import type { SessionStatusStore } from "./session-status.ts";

export function StatusBar({ sessionStatus }: { sessionStatus: SessionStatusStore }): React.ReactNode {
  const status = useSyncExternalStore(sessionStatus.store.subscribe, sessionStatus.store.get);
  const left = `${status.model ?? "connecting..."}  ·  ${status.cwd ?? ""}`;
  const right = status.effort ? `${capitalize(status.effort)} effort` : "";
  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
      <text content={left} style={{ fg: "#414868" }} />
      <text content={right} style={{ fg: "#414868" }} />
    </box>
  );
}
