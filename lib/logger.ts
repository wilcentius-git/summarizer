export const logger = {
  log: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(...args);
    }
  },
  warn: (...args: unknown[]) => {
    // Always log warnings — useful for production debugging
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    // Always log errors regardless of environment
    console.error(...args);
  },
};
