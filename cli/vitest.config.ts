import { defineConfig } from 'vitest/config';

// Every test run gets its own ACStack home, so no test reads or writes ~/.acstack.
export default defineConfig({ test: { setupFiles: ['./src/test-setup.ts'] } });
