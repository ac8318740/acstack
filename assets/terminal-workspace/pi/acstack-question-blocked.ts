import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let pending: { active: boolean; native: boolean } | undefined;
  let forwarding = false;

  pi.events.on("herdr:blocked", (event: unknown) => {
    if (!forwarding && pending && (event as { active?: unknown } | null)?.active === pending.active) {
      pending.native = true;
      pending = undefined;
    }
  });

  pi.events.on("rpiv:ask-user:blocked", (event: unknown) => {
    const active = (event as { active?: unknown } | null)?.active;
    if (typeof active !== "boolean") return;
    const transition = { active, native: false };
    pending = transition;
    // shortcut: dual producers emit public then herdr synchronously; async pairs need an upstream source ID
    queueMicrotask(() => {
      if (pending === transition) pending = undefined;
      if (transition.native) return;
      forwarding = true;
      try {
        pi.events.emit("herdr:blocked", { active });
      } finally {
        forwarding = false;
      }
    });
  });
}
