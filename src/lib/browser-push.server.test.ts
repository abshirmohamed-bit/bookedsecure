import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ devices: [{ id: 'device-a', token: 'token-private' }], reservations: new Map<string,string>(), queries: [] as Array<{table:string;filters:Record<string,unknown>}> }));
vi.mock('@tanstack/react-start', () => ({ createServerOnlyFn: (fn: unknown) => fn }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from(table:string) {
  const filters: Record<string,unknown> = {}; let mode='read'; let value: Record<string,unknown> = {};
  const query = {
    select() { return query; }, eq(k:string,v:unknown) {filters[k]=v; return query;}, in(k:string,v:unknown) {filters[k]=v;return query;}, limit() {return query;},
    insert(v:Record<string,unknown>) {mode='insert';value=v;return query;}, update(v:Record<string,unknown>) {mode='update';value=v;return query;}, delete() {mode='delete';return query;}, single() {return query;},
    then(resolve:(v:unknown)=>unknown) {
      state.queries.push({table,filters}); let data:unknown=null; let error:unknown=null;
      if(table==='profiles') data=[{id:'owner-a'}];
      if(table==='user_roles') data=[{user_id:'owner-a'}];
      if(table==='owner_push_devices') {data=state.devices; if(mode==='delete') state.devices=[];}
      if(table==='owner_push_deliveries') {
        if(mode==='insert') {
          if(state.reservations.has(String(value['alert_key']))) error={code:'23505'};
          else {state.reservations.set(String(value['alert_key']),'reserved');data={id:String(value['alert_key'])};}
        } else if(mode==='update') state.reservations.set(String(filters['id']),String(value['status']));
        else data={status:state.reservations.get(String(filters['alert_key']))};
      }
      return Promise.resolve({data,error}).then(resolve);
    },
  }; return query;
} } }));
import { deliverOwnerPush } from './browser-push.server';
const input={businessId:'tenant-a',alertKey:'lead:a',title:'New enquiry',body:'New enquiry',path:'/leads'};
beforeEach(() => { state.devices=[{id:'device-a',token:'token-private'}];state.reservations.clear();state.queries=[]; vi.stubEnv('LOVABLE_API_KEY','mock-platform');vi.stubEnv('FIREBASE_MESSAGING_API_KEY','mock-connection');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:200}))); });
describe('owner push delivery', () => {
  it('sends only once for repeated alert keys', async () => { expect((await deliverOwnerPush(input)).accepted).toBe(true);expect((await deliverOwnerPush(input)).accepted).toBe(true);expect(fetch).toHaveBeenCalledTimes(1); });
  it('scopes device reads to the requesting tenant and verified owners', async () => {await deliverOwnerPush(input);expect(state.queries.find(q=>q.table==='owner_push_devices')?.filters).toEqual({business_id:'tenant-a',user_id:['owner-a']});});
  it('does not send when credentials are absent',async()=>{vi.stubEnv('FIREBASE_MESSAGING_API_KEY','');expect((await deliverOwnerPush(input)).accepted).toBe(false);expect(fetch).not.toHaveBeenCalled();});
  it('holds unknown outcomes without replay',async()=>{vi.mocked(fetch).mockRejectedValue(new Error('timeout'));expect((await deliverOwnerPush(input)).uncertain).toBe(true);await deliverOwnerPush(input);expect(fetch).toHaveBeenCalledTimes(1);});
  it('removes unregistered device tokens',async()=>{vi.mocked(fetch).mockResolvedValue(new Response('{"error":{"status":"UNREGISTERED"}}',{status:404}));expect((await deliverOwnerPush(input)).accepted).toBe(false);expect(state.devices).toEqual([]);});
  it('reports no registered devices without sending',async()=>{state.devices=[];expect((await deliverOwnerPush(input)).accepted).toBe(false);expect(fetch).not.toHaveBeenCalled();});
});