import { buildApp } from './app.js';

const app = await buildApp();
const { config } = app.ctx;
await app.listen({ port: config.port, host: config.host });
if (config.demoMode) app.log.warn('DEMO_MODE is on: OTP codes are shown on screen and payments are simulated.');
