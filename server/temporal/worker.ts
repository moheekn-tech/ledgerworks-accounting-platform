import '../config.js';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.js';
import { fileURLToPath } from 'node:url';
const connection=await NativeConnection.connect({address:process.env.TEMPORAL_ADDRESS??'localhost:7233'});
const worker=await Worker.create({connection,namespace:process.env.TEMPORAL_NAMESPACE??'default',taskQueue:'accounting',workflowsPath:fileURLToPath(new URL('./workflows.js',import.meta.url)),activities,bundlerOptions:{webpackConfigHook(config){config.module={...config.module,rules:[]};return config;}}});
await worker.run();

