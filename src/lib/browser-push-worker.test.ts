import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker() {
  let background: ((p:unknown)=>unknown) | undefined;
  let click: ((p:unknown)=>unknown) | undefined;
  const showNotification=vi.fn();const openWindow=vi.fn();
  const self={location:new URL('https://bookedsecure.com/firebase-messaging-sw.js?apiKey=public&projectId=project&appId=1:123:web:abc&messagingSenderId=123'), registration:{showNotification},clients:{matchAll:async()=>[],openWindow},addEventListener:(_name:string,fn:typeof click)=>{click=fn;}};
  const initializeApp=vi.fn();
  runInNewContext(readFileSync('public/firebase-messaging-sw.js','utf8'),{self,URL,importScripts:vi.fn(),firebase:{initializeApp,messaging:()=>({onBackgroundMessage:(fn:typeof background)=>{background=fn;}})}});
  return {background,click,showNotification,openWindow,initializeApp};
}
describe('Firebase messaging worker',()=>{
  it('initializes with the messaging sender ID',()=>{const w=worker();expect(w.initializeApp).toHaveBeenCalledWith({apiKey:'public',projectId:'project',appId:'1:123:web:abc',messagingSenderId:'123'});});
  it('displays one background notification with stable alert tag',()=>{const w=worker();w.background?.({data:{title:'New lead',body:'New enquiry',path:'/leads',alert_key:'lead:1'}});expect(w.showNotification).toHaveBeenCalledTimes(1);expect(w.showNotification).toHaveBeenCalledWith('New lead',expect.objectContaining({tag:'lead:1',data:{path:'/leads'}}));});
  it('opens the inbox without allowing external click destinations',async()=>{const w=worker();let pending:Promise<unknown> | undefined;w.click?.({notification:{close:vi.fn(),data:{path:'//malicious.example'}},waitUntil:(p:Promise<unknown>)=>{pending=p;}});await pending;expect(w.openWindow).toHaveBeenCalledWith('https://bookedsecure.com/leads');});
});