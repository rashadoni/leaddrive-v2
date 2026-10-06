import { defineConfig } from 'vitest/config'
export default defineConfig({test:{root:'/tmp/hrm-independent-perf',include:['index.test.ts'],environment:'node',maxWorkers:1,testTimeout:120000},resolve:{alias:{'@':'/workspace/hrm-sweep-draft/src'}}})
