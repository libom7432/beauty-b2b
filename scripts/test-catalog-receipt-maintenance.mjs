import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ReceiptLifecycleMaintenance, RECEIPT_MAINTENANCE_BUSY_SQLSTATE } from '../src/lib/catalog-import/receipt-maintenance.ts';
import { replayCatalogReceipt } from '../src/lib/catalog-import/receipt.ts';

const day=86400000;
const start=Date.parse('2026-01-01T00:00:00Z');
const fingerprint='a'.repeat(64);
const result={status:'committed',import_batch_id:'synthetic-batch',snapshot_version:{
  contract:'catalog-snapshot-v1',template_version:'catalog-attributes-v1',digest:'b'.repeat(64)},product_count:0,identity_map:{}};
const row=(key,ageDays)=>({actor_id:'synthetic-actor',idempotency_key:key,request_fingerprint:fingerprint,
  status:'committed',result:structuredClone(result),completed_at:start-ageDays*day,
  retry_until:start-ageDays*day+30*day,result_purge_after:start-ageDays*day+90*day,expired_at:null});
const code=(value)=>(error)=>error?.code===value;

/** Only an in-memory, synthetic database clock; no PostgreSQL connection exists. */
class OfflineStore {
  constructor(rows=[],now=start) {this.rows=new Map(rows.map(r=>[r.idempotency_key,structuredClone(r)]));this.now=now;this.allowed=false;
    this.locked=false;this.failAt=null;this.calls=[];this.discards=0;}
  async authorizeTask(){return this.allowed;}
  async begin(){
    this.calls.push('begin');
    let local,closed=false,acquired=false;
    const unlock=()=>{if(!closed){closed=true;if(acquired)this.locked=false;}};
    return {
      acquireCatalogLock: async()=>{
        this.calls.push('lock');
        if(this.locked)throw Object.assign(new Error('synthetic lock busy'),{code:RECEIPT_MAINTENANCE_BUSY_SQLSTATE});
        this.locked=true;acquired=true;
        local=new Map([...this.rows].map(([k,v])=>[k,structuredClone(v)]));
      },
      purgeDue: async(limit)=>{
        this.calls.push('purge');
        const cutoff=this.now;
        const due=[...local.values()].filter(r=>r.status==='committed'&&r.result_purge_after<cutoff)
          .sort((a,b)=>a.result_purge_after-b.result_purge_after||a.actor_id.localeCompare(b.actor_id)||a.idempotency_key.localeCompare(b.idempotency_key))
          .slice(0,limit);
        for(const r of due){r.status='expired';r.result=null;r.expired_at=cutoff;}
        if(this.failAt==='purge')throw new Error('synthetic failure');
        return due.length;
      },
      commit: async()=>{
        this.calls.push('commit');
        if(this.failAt==='before_commit')throw new Error('synthetic transport failure');
        this.rows=local;unlock();
        if(this.failAt==='after_commit')throw new Error('synthetic lost acknowledgement');
      },
      rollback: async()=>{this.calls.push('rollback');unlock();if(this.failAt==='rollback')throw new Error('synthetic rollback failure');},
      discard: ()=>{this.calls.push('discard');this.discards++;unlock();},
    };
  }
}
const engine=(store)=>new ReceiptLifecycleMaintenance(store);

test('authorization defaults to deny and batch sizes are bounded',async()=>{
  const s=new OfflineStore([row('due',91)]);
  await assert.rejects(engine(s).runBatch(),code('PERMISSION_DENIED'));
  assert.deepEqual(s.calls,[]);
  s.authorizeTask=async()=>{throw new Error('synthetic provider failure');};
  await assert.rejects(engine(s).runBatch(),code('PERMISSION_DENIED'));
  assert.deepEqual(s.calls,[]);
  s.authorizeTask=async()=>true;
  for(const n of [0,-1,501,1.5,Number.NaN,Infinity])await assert.rejects(engine(s).runBatch(n),code('INVALID_BATCH_LIMIT'));
  assert.deepEqual(s.calls,[]);
});

test('30-day replay is inclusive; later retry and changed fingerprint are rejected',()=>{
  const r=row('replay',0);
  const at=(t)=>({request_fingerprint:r.request_fingerprint,status:r.status,result:r.result,within_retry_window:t<=r.retry_until});
  assert.equal(replayCatalogReceipt(at(r.completed_at+29*day),fingerprint).replayed,true);
  assert.equal(replayCatalogReceipt(at(r.retry_until),fingerprint).replayed,true);
  assert.throws(()=>replayCatalogReceipt(at(r.retry_until+1),fingerprint),code('IDEMPOTENCY_KEY_EXPIRED'));
  assert.throws(()=>replayCatalogReceipt(at(r.retry_until+1),'c'.repeat(64)),code('IDEMPOTENCY_CONFLICT'));
});

test('90-day exact boundary retains result; after it becomes a permanent tombstone',async()=>{
  const s=new OfflineStore([row('young',89),row('exact',90),row('old',90+1/day)]);s.allowed=true;
  assert.deepEqual(await engine(s).runBatch(100),{purged_count:1});
  assert.ok(s.rows.get('young').result);
  assert.ok(s.rows.get('exact').result);
  const old=s.rows.get('old');
  assert.equal(old.status,'expired');assert.equal(old.result,null);
  assert.equal(old.actor_id,'synthetic-actor');assert.equal(old.idempotency_key,'old');
  assert.equal(old.request_fingerprint,fingerprint);assert.equal(old.completed_at,start-(90+1/day)*day);
  assert.equal(old.retry_until,old.completed_at+30*day);
  assert.equal(old.result_purge_after,old.completed_at+90*day);
  assert.throws(()=>replayCatalogReceipt({request_fingerprint:old.request_fingerprint,status:old.status,
    result:old.result,within_retry_window:false},fingerprint),code('IDEMPOTENCY_KEY_EXPIRED'));
  assert.equal((await engine(s).runBatch()).purged_count,0);
  assert.equal(s.rows.size,3);
  s.now+=1;
  assert.equal((await engine(s).runBatch()).purged_count,1);
});

test('lock busy fails immediately without purging and later retry succeeds',async()=>{
  const s=new OfflineStore([row('due',91)]);s.allowed=true;s.locked=true;
  await assert.rejects(engine(s).runBatch(),code('CATALOG_RECEIPT_MAINTENANCE_BUSY'));
  assert.equal(s.rows.get('due').status,'committed');
  assert.equal(s.calls.includes('purge'),false);
  assert.equal(s.locked,true,'failed contender must not release another transaction lock');
  s.locked=false;
  assert.equal((await engine(s).runBatch()).purged_count,1);
});

test('SQLSTATE 55P03 from the restricted function maps to the same busy code',async()=>{
  const s=new OfflineStore([row('due',91)]);s.allowed=true;
  const original=s.begin.bind(s);
  s.begin=async()=>{const tx=await original();return {...tx,purgeDue:async()=>{
    throw Object.assign(new Error('database lock unavailable'),{code:RECEIPT_MAINTENANCE_BUSY_SQLSTATE});
  }};};
  await assert.rejects(engine(s).runBatch(),code('CATALOG_RECEIPT_MAINTENANCE_BUSY'));
  assert.equal(s.rows.get('due').status,'committed');
  s.begin=original;
  assert.equal((await engine(s).runBatch()).purged_count,1);
});

test('bounded batches and concurrent workers report busy, then retry safely',async()=>{
  const s=new OfflineStore([row('a',91),row('b',92),row('c',93)]);s.allowed=true;
  const out=await Promise.allSettled([engine(s).runBatch(2),engine(s).runBatch(2)]);
  assert.equal(out.filter(v=>v.status==='fulfilled'&&v.value.purged_count===2).length,1);
  assert.equal(out.filter(v=>v.status==='rejected'&&v.reason.code==='CATALOG_RECEIPT_MAINTENANCE_BUSY').length,1);
  assert.equal((await engine(s).runBatch(2)).purged_count,1);
  assert.equal((await engine(s).runBatch(2)).purged_count,0);
  assert.equal([...s.rows.values()].filter(v=>v.status==='expired').length,3);
  assert.equal(s.calls.includes('lock'),true);
});

test('one database cutoff is reused for selection and expired_at',async()=>{
  const s=new OfflineStore([row('exact',90),row('old',91)]);s.allowed=true;
  let reads=0;
  Object.defineProperty(s,'now',{get(){reads++;return start;}});
  assert.equal((await engine(s).runBatch()).purged_count,1);
  assert.equal(reads,1);
  assert.equal(s.rows.get('exact').status,'committed');
  assert.equal(s.rows.get('old').expired_at,start);
});

test('mid-batch failure rolls back and a subsequent run resumes',async()=>{
  const s=new OfflineStore([row('a',91),row('b',91)]);s.allowed=true;s.failAt='purge';
  await assert.rejects(engine(s).runBatch(1),code('MAINTENANCE_FAILED'));
  assert.equal([...s.rows.values()].filter(v=>v.status==='expired').length,0);
  s.failAt=null;
  assert.equal((await engine(s).runBatch(1)).purged_count,1);
  assert.equal((await engine(s).runBatch(1)).purged_count,1);
});

test('lost commit acknowledgement is ambiguous; safe repeat cannot purge twice',async()=>{
  const s=new OfflineStore([row('a',91)]);s.allowed=true;s.failAt='after_commit';
  await assert.rejects(engine(s).runBatch(),code('COMMIT_UNKNOWN'));
  assert.equal(s.rows.get('a').status,'expired');
  s.failAt=null;
  assert.equal((await engine(s).runBatch()).purged_count,0);
  assert.equal(s.rows.size,1);
});

test('failed commit before persistence remains ambiguous and safely resumes',async()=>{
  const s=new OfflineStore([row('a',91)]);s.allowed=true;s.failAt='before_commit';
  await assert.rejects(engine(s).runBatch(),code('COMMIT_UNKNOWN'));
  assert.equal(s.rows.get('a').status,'committed');
  s.failAt=null;
  assert.equal((await engine(s).runBatch()).purged_count,1);
});

test('failed rollback discards transaction; no state is committed',async()=>{
  const s=new OfflineStore([row('a',91)]);s.allowed=true;s.failAt='rollback';
  // Force an invalid adapter response after the mock update, then fail rollback.
  const original=s.begin.bind(s);
  s.begin=async()=>{const tx=await original();return {...tx,purgeDue:async()=>{await tx.purgeDue(1);return -1;}};};
  await assert.rejects(engine(s).runBatch(),code('MAINTENANCE_FAILED'));
  assert.equal(s.discards,1);assert.equal(s.rows.get('a').status,'committed');
});

test('draft SQL grants only the fixed interface and preserves tombstones',()=>{
  const sql=readFileSync(new URL('../docs/sql/catalog-receipt-lifecycle-maintenance.draft.sql',import.meta.url),'utf8');
  const original=readFileSync(new URL('../docs/sql/catalog-import-receipts.draft.sql',import.meta.url),'utf8');
  assert.match(sql,/^-- REVIEW DRAFT ONLY/);
  assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql,/IF NOT pg_catalog\.pg_try_advisory_xact_lock\(725604510131::bigint\) THEN/);
  assert.match(sql,/RAISE EXCEPTION 'Catalog receipt maintenance busy' USING ERRCODE='55P03'/);
  assert.match(sql,/LIMIT p_limit FOR UPDATE SKIP LOCKED/);
  const body=sql.split('AS $function$')[1].split('$function$;')[0];
  assert.ok(body.indexOf('pg_try_advisory_xact_lock') < body.indexOf('WITH due AS MATERIALIZED'));
  assert.ok(body.indexOf("RAISE EXCEPTION 'Catalog receipt maintenance busy'") < body.indexOf('WITH due AS MATERIALIZED'));
  assert.equal((body.match(/pg_catalog\.statement_timestamp\(\)/g)||[]).length,1);
  assert.match(body,/v_cutoff := pg_catalog\.statement_timestamp\(\)/);
  assert.equal((body.match(/result_purge_after < v_cutoff/g)||[]).length,2);
  assert.equal((sql.match(/result_purge_after < pg_catalog\.statement_timestamp\(\)/g)||[]).length,2);
  assert.match(sql,/SET status='expired',result=NULL,expired_at=v_cutoff/);
  assert.match(sql,/SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp/);
  assert.match(sql,/REVOKE ALL ON FUNCTION catalog_private\.purge_due_catalog_receipt_results\(integer\) FROM PUBLIC/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION catalog_private\.purge_due_catalog_receipt_results\(integer\)\s+TO catalog_receipt_maintenance/);
  assert.doesNotMatch(sql,/\b(?:DROP TABLE|TRUNCATE|DELETE FROM|GRANT EXECUTE[^;]+TO catalog_import|GRANT EXECUTE[^;]+TO catalog_admin|GRANT EXECUTE[^;]+TO anon)\b/i);
  assert.doesNotMatch(sql,/\brfq_/i);
  assert.match(original,/PRIMARY KEY \(actor_id, idempotency_key\)/);
  assert.match(original,/status = 'expired' AND result IS NULL/);
});

test('incremental RLS repair admits the expired RETURNING row without widening UPDATE',()=>{
  const fix=readFileSync(new URL('../docs/sql/catalog-receipt-lifecycle-rls-fix.draft.sql',import.meta.url),'utf8');
  const maintenance=readFileSync(new URL('../docs/sql/catalog-receipt-lifecycle-maintenance.draft.sql',import.meta.url),'utf8');
  assert.match(fix,/^-- REVIEW DRAFT ONLY/);
  assert.match(fix,/BEGIN;[\s\S]*COMMIT;/);
  assert.match(fix,/ALTER POLICY catalog_receipt_lifecycle_owner_read\s+ON catalog_private\.catalog_import_receipts/);
  assert.match(fix,/result_purge_after < pg_catalog\.statement_timestamp\(\)\s+AND status IN \('committed', 'expired'\)/);
  assert.match(fix,/p\.with_check = '\(\(status = ''expired''::text\) AND \(expired_at > result_purge_after\)\)'/);
  assert.match(maintenance,/WITH CHECK \(status='expired' AND expired_at > result_purge_after\)/);
  assert.match(maintenance,/WHERE r\.status='committed' AND r\.result_purge_after < v_cutoff/);
  assert.match(maintenance,/RETURNING 1/);
  assert.doesNotMatch(fix,/^\s*(?:ALTER POLICY catalog_receipt_lifecycle_owner_expire|GRANT|REVOKE|CREATE ROLE|ALTER ROLE|UPDATE|DELETE FROM|DROP TABLE|TRUNCATE)\b/im);
  assert.doesNotMatch(fix,/\b(?:rfq_|catalog_import_receipts_insert|catalog_receipt_lookup_owner_read)\b/i);
  assert.doesNotMatch(fix,/WITH CHECK\s*\(\s*true\s*\)/i);
});

test('expired tombstones stay unchanged and original identities and deadlines survive repeated batches',async()=>{
  const already={...row('already',91),status:'expired',result:null,expired_at:start-day};
  const due=row('due',91);
  const s=new OfflineStore([already,due]);s.allowed=true;
  const originals=new Map([...s.rows].map(([key,value])=>[key,structuredClone(value)]));
  assert.deepEqual(await engine(s).runBatch(),{purged_count:1});
  assert.deepEqual(s.rows.get('already'),originals.get('already'));
  const after=s.rows.get('due');
  for(const field of ['actor_id','idempotency_key','request_fingerprint','completed_at','retry_until','result_purge_after'])
    assert.equal(after[field],originals.get('due')[field],field);
  assert.equal(after.status,'expired');assert.equal(after.result,null);
  assert.deepEqual(await engine(s).runBatch(),{purged_count:0});
  assert.deepEqual(s.rows.get('due'),after);
  assert.equal(s.rows.size,2);
});
