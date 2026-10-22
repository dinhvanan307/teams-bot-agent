/** Track handlers even when the transport acknowledges HTTP before work is finished. */
export function createLifecycle(stopTransport: () => Promise<void>, forceClose: () => void) {
  let accepting = true, active = 0;
  let wake: (() => void) | undefined;
  let stopping: Promise<{ drained: boolean }> | undefined;
  return {
    get accepting() { return accepting; },
    get active() { return active; },
    beginDrain() { accepting = false; },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (!accepting) throw new Error('Dịch vụ đang dừng.');
      active++;
      try { return await task(); }
      finally { active--; if (active === 0) wake?.(); }
    },
    shutdown(timeoutMs = 30000): Promise<{ drained: boolean }> {
      if (stopping) return stopping;
      accepting = false;
      stopping = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const idle = active === 0 ? Promise.resolve() : new Promise<void>(resolve => { wake = resolve; });
        const deadline = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
        try {
          const drained = await Promise.race([
            Promise.all([idle, stopTransport()]).then(() => true).catch(() => false), deadline,
          ]);
          if (!drained) forceClose();
          return { drained };
        } finally { clearTimeout(timer); wake = undefined; }
      })();
      return stopping;
    },
  };
}

export function shutdownTimeout(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.SHUTDOWN_TIMEOUT_MS ?? 30000);
  if (!Number.isInteger(value) || value < 100 || value > 120000) throw new Error('SHUTDOWN_TIMEOUT_MS phải trong khoảng 100–120000.');
  return value;
}
