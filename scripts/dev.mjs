import { spawn } from 'node:child_process';
const executables = [['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], ['node_modules/vite/bin/vite.js']];
const children = executables.map(args => spawn(process.execPath, args, { stdio: 'inherit', env: process.env }));
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(p => p.kill()); setTimeout(() => process.exit(code), 300); }
children.forEach(p => p.on('exit', code => stop(code ?? 1)));
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
