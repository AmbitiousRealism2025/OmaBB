export interface Claims {
  wait(id: string): Promise<boolean>;
  grant(id: string): boolean;
}

export function createClaims(timeoutMs: number): Claims {
  const pending = new Map<string, () => void>();
  return {
    wait(id) {
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(false);
        }, timeoutMs);
        pending.set(id, () => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(true);
        });
      });
    },
    grant(id) {
      const resolve = pending.get(id);
      resolve?.();
      return resolve !== undefined;
    },
  };
}
