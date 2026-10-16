/** Local UI verification only; DB is a test double. Never use this entry point for deployment. */
import 'reflect-metadata';import {createServer} from 'node:net';import {spawn} from 'node:child_process';import {Database} from '../src/database';import {MemoryStore} from './memory-store';import {createApp} from '../src/app';
async function main(){
 const store=new MemoryStore();Database.prototype.onModuleInit=async function(){this.collection=store.collection.bind(store);this.client=store.client;this.db=store.db;};
 Object.assign(process.env,{NODE_ENV:'test',JWT_SECRET:'ui-test-only-secret-at-least-32-characters',ADMIN_PASSWORD:'PreviewAdmin_123456',DEMO_PASSWORD:'PreviewDemo_123456',SEED_DEMO:'true',MQTT_USERNAME:'energy_api',MQTT_PASSWORD:'ui-mqtt',SIM_MQTT_PASSWORD:'ui-mqtt',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:''});
 const broker=require('aedes')();broker.authenticate=(c:any,u:any,p:any,done:any)=>done(null,p?.toString()==='ui-mqtt');const server=createServer(broker.handle);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.MQTT_URL=`mqtt://127.0.0.1:${(server.address()as any).port}`;
 const app=await createApp();await app.listen(3100,'127.0.0.1');const sim=spawn(process.execPath,['scripts/simulator.mjs'],{env:process.env,stdio:'inherit'});console.log('UI test harness http://127.0.0.1:3100');
 const stop=async()=>{sim.kill();await app.close();server.close();broker.close();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
main().catch(e=>{console.error(e);process.exit(1)});
