import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TAKEOVER = "acstack:question-blocked:takeover";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    pi.events.emit(TAKEOVER, {});
    // Register after legacy factories so our synchronous relay suppresses their queued copy.
    // shortcut: legacy compatibility excludes recursively emitted public events; remove the legacy copy if needed
    const stopRelay = pi.events.on("rpiv:ask-user:blocked", (event: unknown) => {
      const active = (event as { active?: unknown } | null)?.active;
      if (typeof active === "boolean") pi.events.emit("herdr:blocked", { active });
    });
    const stopTakeover = pi.events.on(TAKEOVER, () => {
      stopRelay();
      stopTakeover();
    });
  });
}
