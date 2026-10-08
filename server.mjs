import http from 'node:http';
import handler from './app.mjs';
import {getRuntime} from './lib/runtime.mjs';
const {origin}=getRuntime();
http.createServer(handler).listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log(`Jainam Finance: ${origin} (authentication required)`));
