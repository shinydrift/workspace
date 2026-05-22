export async function safeInvoke<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[safeInvoke] ${label}`, err);
    return null;
  }
}
