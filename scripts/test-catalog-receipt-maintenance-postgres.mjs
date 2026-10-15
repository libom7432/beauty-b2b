// Explicitly run only against the approved isolated local cluster. No production entrypoint.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const target={host:'127.0.0.1',port:55440,database:'catalog_receipts_d2b_test',
  user:'catalog_d2b_owner'};
const dataDirectory=process.env.CATALOG_IMPORT_TEST_DATA_DIR;
const approvedDirectoryDigest='e578f371b4ca035c6d67d7ec8a595d34f6af44c0c37e0d402ff1c8ab76e55b97';
if(!dataDirectory || createHash('sha256').update(dataDirectory,'utf8').digest('hex')!==approvedDirectoryDigest)
  throw new Error('Explicit approved local data directory is required');
const systemIdentifier='7696419892593432091';
const actor='c2b2_synthetic_actor';
const otherActor='c2b2_synthetic_actor_b';
const fingerprint='a'.repeat(64);
const result={status:'committed',import_batch_id:'c2b2-synthetic',product_count:0};
const roles={maint:'c2b2_maint_login',import:'c2b2_import_login',admin:'c2b2_admin_login',
  anon:'c2b2_anon_login',stranger:'c2b2_stranger_login',probe:'c2b2_owner_probe_login'};
const memberships={maint:'catalog_receipt_maintenance',import:'catalog_import',
  admin:'catalog_admin',anon:'anon',probe:'catalog_receipt_lifecycle_owner'};
const owner=new pg.Client(target);
const clients=[];
const passwords=new Map();
let rolesCreated=false;
const marks=[];
const mark=(name)=>{marks.push(name);console.log(`PASS ${name}`);};
const allRows=()=>owner.query('SELECT actor_id,idempotency_key,request_fingerprint,status,result,created_at,completed_at,retry_until,result_purge_after,expired_at FROM catalog_private.catalog_import_receipts WHERE actor_id=$1 ORDER BY idempotency_key',[actor]);
const assertIdentity=async(client,expectedUser)=>{
  const {rows:[r]}=await client.query(`SELECT host(inet_server_addr()) host,inet_server_port() port,
    current_database() db,session_user session_user,current_user current_user,
    current_setting('server_version') server_version`);
  assert.deepEqual([r.host,r.port,r.db,r.session_user,r.current_user,r.server_version],
    ['127.0.0.1',55440,'catalog_receipts_d2b_test',expectedUser,expectedUser,'17.11 (Postgres.app)']);
  if(expectedUser===target.user){
    const {rows:[physical]}=await client.query(`SELECT current_setting('data_directory') data_dir,
      current_setting('listen_addresses') listens,
      (SELECT system_identifier::text FROM pg_control_system()) system_id`);
    assert.deepEqual([physical.data_dir,physical.listens,physical.system_id],
      [dataDirectory,'127.0.0.1',systemIdentifier]);
  }
  return r;
};
const expectCode=async(run,codes)=>{
  await assert.rejects(run,err=>codes.includes(err?.code),`expected ${codes.join(' or ')}`);
};
const connectAs=async(kind)=>{
  const client=new pg.Client({...target,user:roles[kind],password:passwords.get(kind)});
  await client.connect();clients.push(client);
  await assertIdentity(client,roles[kind]);
  if(memberships[kind]){
    await client.query(`SET ROLE ${memberships[kind]}`);
    assert.equal((await client.query('SELECT current_user who')).rows[0].who,memberships[kind]);
  }
  assert.equal((await client.query('SELECT rolsuper OR rolbypassrls bad FROM pg_roles WHERE rolname=session_user')).rows[0].bad,false);
  return client;
};
const seed=async(key,ageDays,status='committed')=>{
  const expired=status==='expired';
  await owner.query(`INSERT INTO catalog_private.catalog_import_receipts
    (actor_id,idempotency_key,request_fingerprint,status,result,completed_at,retry_until,result_purge_after,expired_at)
    SELECT $1,$2,$3,$4,CASE WHEN $5 THEN NULL ELSE $6::jsonb END,t,t+interval '30 days',
      t+interval '90 days',CASE WHEN $5 THEN clock_timestamp() ELSE NULL END
    FROM (SELECT clock_timestamp()-($7::numeric * interval '1 day') t) AS x`,
    [actor,key,fingerprint,status,expired,JSON.stringify(result),ageDays]);
};
const status=async(key)=>{
  const {rows:[r]}=await owner.query('SELECT status,result,expired_at FROM catalog_private.catalog_import_receipts WHERE actor_id=$1 AND idempotency_key=$2',[actor,key]);
  return r;
};
const purge=(client,limit=500)=>client.query('SELECT catalog_private.purge_due_catalog_receipt_results($1) purged',[limit]).then(r=>r.rows[0].purged);

try{
  await owner.connect();
  await assertIdentity(owner,target.user);
  const baseline=await owner.query(`SELECT
    (SELECT count(*)::int FROM catalog_private.products) products,
    (SELECT count(*)::int FROM catalog_private.product_variants) variants,
    (SELECT count(*)::int FROM catalog_private.categories) categories,
    (SELECT count(*)::int FROM catalog_private.product_categories) product_categories,
    (SELECT count(*)::int FROM catalog_private.product_images) images,
    (SELECT count(*)::int FROM catalog_private.product_translations) translations,
    (SELECT count(*)::int FROM catalog_private.catalog_import_receipts) receipts,
    (SELECT count(*)::int FROM pg_namespace WHERE nspname ILIKE '%rfq%') rfq`);
  assert.ok(Object.values(baseline.rows[0]).every(v=>v===0));
  const existing=await owner.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(roles)]);
  assert.equal(existing.rowCount,0);
  mark('physical target and empty baseline');

  // Only fixed, synthetic role identifiers enter the DDL. Passwords are generated in memory and never logged.
  for(const [kind,name] of Object.entries(roles)){
    const pass=randomBytes(32).toString('hex');passwords.set(kind,pass);
    await owner.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${pass}'`);
    rolesCreated=true;
    if(memberships[kind])await owner.query(`GRANT ${memberships[kind]} TO ${name} WITH INHERIT FALSE, SET TRUE`);
  }
  const maint=await connectAs('maint');
  const maint2=await connectAs('maint');
  const importer=await connectAs('import');
  const admin=await connectAs('admin');
  const anon=await connectAs('anon');
  const stranger=await connectAs('stranger');
  const probe=await connectAs('probe');
  mark('independent non-superuser login sessions');

  for(const c of [importer,admin,anon,stranger])
    await expectCode(c.query('SELECT catalog_private.purge_due_catalog_receipt_results(1)'),['42501']);
  for(const c of [importer,admin,anon,stranger])
    await expectCode(c.query('SELECT result FROM catalog_private.catalog_import_receipts'),['42501']);
  await expectCode(importer.query('DELETE FROM catalog_private.catalog_import_receipts WHERE actor_id=$1',[actor]),['42501']);
  for(const c of [admin,anon,stranger,maint])
    await expectCode(c.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'unknown']),['42501']);
  assert.equal((await importer.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'unknown'])).rowCount,0);
  await expectCode(importer.query('SET ROLE catalog_receipt_lookup_owner'),['42501']);
  await expectCode(admin.query('SET ROLE catalog_import'),['42501']);
  await expectCode(maint.query('SELECT result FROM catalog_private.catalog_import_receipts'),['42501']);
  await expectCode(maint.query('SELECT status FROM catalog_private.catalog_import_receipts'),['42501']);
  await expectCode(maint.query("UPDATE catalog_private.catalog_import_receipts SET status='expired' WHERE actor_id=$1",[actor]),['42501']);
  await expectCode(maint.query('DELETE FROM catalog_private.catalog_import_receipts WHERE actor_id=$1',[actor]),['42501']);
  await expectCode(maint.query('UPDATE catalog_private.products SET status=status'),['42501']);
  await expectCode(maint.query('SET ROLE catalog_receipt_lifecycle_owner'),['42501']);
  await expectCode(probe.query('SELECT result FROM catalog_private.catalog_import_receipts'),['42501']);
  const meta=await owner.query(`SELECT p.prosecdef,p.proconfig,r.rolname,r.rolsuper,r.rolbypassrls,
    c.relrowsecurity,c.relforcerowsecurity,p.proacl
    FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    JOIN pg_class c ON c.oid='catalog_private.catalog_import_receipts'::regclass
    WHERE p.oid='catalog_private.purge_due_catalog_receipt_results(integer)'::regprocedure`);
  assert.equal(meta.rows[0].rolname,'catalog_receipt_lifecycle_owner');
  assert.equal(meta.rows[0].prosecdef,true);
  assert.equal(meta.rows[0].rolsuper,false);assert.equal(meta.rows[0].rolbypassrls,false);
  assert.equal(meta.rows[0].relrowsecurity,true);assert.equal(meta.rows[0].relforcerowsecurity,true);
  assert.deepEqual(meta.rows[0].proconfig,['search_path=pg_catalog, pg_temp']);
  mark('function ACL, RLS/FORCE RLS and role denial');

  await seed('early',89);
  await seed('old',91);
  await seed('already',91,'expired');
  const before=new Map((await allRows()).rows.map(r=>[r.idempotency_key,r]));
  assert.equal(await purge(maint,500),1);
  assert.equal((await status('early')).status,'committed');
  assert.equal((await status('old')).status,'expired');
  assert.equal((await status('old')).result,null);
  assert.deepEqual(await status('already'),{status:'expired',result:null,expired_at:before.get('already').expired_at});
  for(const field of ['actor_id','idempotency_key','request_fingerprint','created_at','completed_at','retry_until','result_purge_after'])
    assert.deepEqual((await allRows()).rows.find(r=>r.idempotency_key==='old')[field],before.get('old')[field]);
  assert.equal(await purge(maint,500),0);
  const visible=(await probe.query('SELECT idempotency_key,status FROM catalog_private.catalog_import_receipts WHERE actor_id=$1 ORDER BY idempotency_key',[actor])).rows;
  assert.deepEqual(visible.map(r=>r.idempotency_key),['already','old']);
  assert.equal((await probe.query("UPDATE catalog_private.catalog_import_receipts SET status='committed' WHERE actor_id=$1 AND idempotency_key='old'",[actor])).rowCount,0);
  await seed('probe_due',91);
  await expectCode(probe.query("UPDATE catalog_private.catalog_import_receipts SET status='committed' WHERE actor_id=$1 AND idempotency_key='probe_due'",[actor]),['42501']);
  await expectCode(probe.query('UPDATE catalog_private.catalog_import_receipts SET request_fingerprint=$1 WHERE actor_id=$2',['b'.repeat(64),actor]),['42501']);
  await expectCode(probe.query('UPDATE catalog_private.catalog_import_receipts SET actor_id=$1 WHERE actor_id=$2',['different_synthetic_actor',actor]),['42501']);
  await expectCode(probe.query('UPDATE catalog_private.catalog_import_receipts SET idempotency_key=$1 WHERE actor_id=$2',['different_synthetic_key',actor]),['42501']);
  assert.equal(await purge(maint),1);
  mark('UPDATE RETURNING repair, selective RLS, tombstones and immutable fields');

  // One top-level statement supplies the same statement_timestamp to the inserted exact-boundary row and purge function.
  await owner.query(`DO $exact$ DECLARE t timestamptz:=statement_timestamp(); n integer; BEGIN
    INSERT INTO catalog_private.catalog_import_receipts
      (actor_id,idempotency_key,request_fingerprint,status,result,completed_at,retry_until,result_purge_after)
    VALUES ('${actor}','exact','${fingerprint}','committed','{"status":"committed"}'::jsonb,
      t-interval '90 days',t-interval '60 days',t);
    SELECT catalog_private.purge_due_catalog_receipt_results(500) INTO n;
    IF n <> 0 OR (SELECT status FROM catalog_private.catalog_import_receipts
      WHERE actor_id='${actor}' AND idempotency_key='exact') <> 'committed'
      THEN RAISE EXCEPTION 'Exact 90-day boundary was purged'; END IF;
  END $exact$`);
  assert.equal((await status('exact')).status,'committed');
  assert.equal(await purge(maint,500),1);
  mark('exact and strictly-after 90-day database-time boundary');

  const replay=await importer.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'early']);
  assert.equal(replay.rowCount,1);assert.equal(replay.rows[0].status,'committed');
  assert.equal(replay.rows[0].within_retry_window,false);
  const lookupDefinition=(await owner.query("SELECT pg_get_functiondef('catalog_private.lookup_catalog_import_receipt(text,text)'::regprocedure) body")).rows[0].body;
  assert.match(lookupDefinition,/clock_timestamp\(\) <= r\.retry_until/);
  await seed('inside30',29.99);
  await seed('outside30',30.01);
  assert.equal((await importer.query('SELECT within_retry_window FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'inside30'])).rows[0].within_retry_window,true);
  assert.equal((await importer.query('SELECT within_retry_window FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'outside30'])).rows[0].within_retry_window,false);
  await importer.query('BEGIN');
  await importer.query(`INSERT INTO catalog_private.catalog_import_receipts
    (actor_id,idempotency_key,request_fingerprint,status,result,completed_at,retry_until,result_purge_after)
    SELECT $1,'fresh',$2,'committed',$3::jsonb,t,t+interval '30 days',t+interval '90 days'
    FROM (SELECT clock_timestamp() t) s`,[actor,fingerprint,JSON.stringify(result)]);
  await importer.query('COMMIT');
  // Model a lost client acknowledgement: discard the COMMIT return and recover on a new login session.
  const importRecovery=await connectAs('import');
  const fresh=await importRecovery.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'fresh']);
  assert.equal(fresh.rowCount,1);assert.equal(fresh.rows[0].within_retry_window,true);
  await importer.query(`INSERT INTO catalog_private.catalog_import_receipts
    (actor_id,idempotency_key,request_fingerprint,status,result,completed_at,retry_until,result_purge_after)
    SELECT $1,'fresh',$2,'committed',$3::jsonb,t,t+interval '30 days',t+interval '90 days'
    FROM (SELECT clock_timestamp() t) s`,[otherActor,'b'.repeat(64),JSON.stringify(result)]);
  const otherReceipt=await importRecovery.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[otherActor,'fresh']);
  assert.equal(otherReceipt.rows[0].request_fingerprint,'b'.repeat(64));
  assert.equal((await importRecovery.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'fresh'])).rows[0].request_fingerprint,fingerprint);
  // The shared database role can choose either actor parameter; application identity isolation remains necessary.
  await importer.query('CREATE TEMP TABLE catalog_import_receipts (synthetic_marker text)');
  const unshadowed=await importer.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'fresh']);
  assert.deepEqual(unshadowed.rows,fresh.rows);
  assert.equal(await purge(maint),0);
  const recovered=await importRecovery.query('SELECT * FROM catalog_private.lookup_catalog_import_receipt($1,$2)',[actor,'fresh']);
  assert.deepEqual(recovered.rows,fresh.rows);
  await expectCode(importer.query(`INSERT INTO catalog_private.catalog_import_receipts
    (actor_id,idempotency_key,request_fingerprint,status,result,completed_at,retry_until,result_purge_after)
    SELECT $1,'old',$2,'committed',$3::jsonb,t,t+interval '30 days',t+interval '90 days'
      FROM (SELECT clock_timestamp() t) s`,[actor,fingerprint,JSON.stringify(result)]),['23505']);
  mark('restricted_v1 recovery and permanent idempotency key');

  await seed('locked',91);
  await owner.query('BEGIN');
  try{
    await owner.query('SELECT pg_advisory_xact_lock(725604510131::bigint)');
    await expectCode(maint.query('SELECT catalog_private.purge_due_catalog_receipt_results(500)'),['55P03']);
    assert.equal((await status('locked')).status,'committed');
  } finally {await owner.query('ROLLBACK');}
  assert.equal(await purge(maint),1);
  mark('import-lock contention, SQLSTATE 55P03, no modification and retry');

  await seed('worker',91);
  await maint.query('BEGIN');
  try{
    assert.equal(await purge(maint),1);
    await expectCode(maint2.query('SELECT catalog_private.purge_due_catalog_receipt_results(500)'),['55P03']);
  } finally {await maint.query('COMMIT');}
  assert.equal((await status('worker')).status,'expired');
  assert.equal(await purge(maint2),0);
  mark('two maintenance connections serialize without false zero');

  await seed('rollback',91);
  await maint.query('BEGIN');
  assert.equal(await purge(maint),1);
  await expectCode(maint.query('SELECT 1/0'),['22012']);
  await maint.query('ROLLBACK');
  assert.equal((await status('rollback')).status,'committed');
  assert.equal(await purge(maint),1);
  mark('failed transaction rolls back all receipt changes');

  await owner.query(`INSERT INTO catalog_private.catalog_import_receipts
    (actor_id,idempotency_key,request_fingerprint,status,result,completed_at,retry_until,result_purge_after)
    SELECT $1,'batch'||n,$2,'committed',$3::jsonb,t,t+interval '30 days',t+interval '90 days'
    FROM generate_series(1,503) n CROSS JOIN (SELECT clock_timestamp()-interval '91 days' t) s`,
    [actor,fingerprint,JSON.stringify(result)]);
  await expectCode(maint.query('SELECT catalog_private.purge_due_catalog_receipt_results(501)'),['22023']);
  const plan=(await owner.query(`EXPLAIN (FORMAT JSON) SELECT actor_id,idempotency_key
    FROM catalog_private.catalog_import_receipts WHERE status='committed'
    AND result_purge_after < statement_timestamp()
    ORDER BY result_purge_after,actor_id,idempotency_key
    LIMIT 500 FOR UPDATE SKIP LOCKED`)).rows[0]['QUERY PLAN'][0].Plan;
  const nodes=[];const walk=n=>{nodes.push([n['Node Type'],n['Index Name']??null]);for(const c of n.Plans??[])walk(c);};walk(plan);
  console.log('EXPLAIN nodes:',JSON.stringify(nodes));
  assert.ok(nodes.some(([,name])=>name==='catalog_import_receipts_purge_due_idx'));
  const protectedPlan=(await probe.query(`EXPLAIN (FORMAT JSON) SELECT actor_id,idempotency_key
    FROM catalog_private.catalog_import_receipts WHERE status='committed'
    AND result_purge_after < statement_timestamp()
    ORDER BY result_purge_after,actor_id,idempotency_key
    LIMIT 500 FOR UPDATE SKIP LOCKED`)).rows[0]['QUERY PLAN'][0].Plan;
  const protectedNodes=[];const walkProtected=n=>{protectedNodes.push([n['Node Type'],n['Index Name']??null]);for(const c of n.Plans??[])walkProtected(c);};walkProtected(protectedPlan);
  console.log('RLS EXPLAIN nodes:',JSON.stringify(protectedNodes));
  assert.ok(protectedNodes.some(([,name])=>name==='catalog_import_receipts_purge_due_idx'));
  assert.equal(await purge(maint,500),500);
  assert.equal(await purge(maint,500),3);
  assert.equal(await purge(maint,500),0);
  const counts=await owner.query(`SELECT status,count(*)::int n FROM catalog_private.catalog_import_receipts
    WHERE actor_id=$1 AND left(idempotency_key,5)='batch' GROUP BY status`,[actor]);
  assert.deepEqual(counts.rows,[{status:'expired',n:503}]);
  mark('500-row bound, multi-batch idempotence and EXPLAIN');

  await maint.query('CREATE TEMP TABLE catalog_import_receipts (synthetic_marker text)');
  await seed('shadow',91);
  assert.equal(await purge(maint,500),1);
  assert.equal((await status('shadow')).status,'expired');
  mark('temporary table cannot redirect schema-qualified maintenance function');
} finally {
  for(const client of clients.reverse())try{await client.end();}catch{}
  try{
    if(owner._connected){
      await assertIdentity(owner,target.user);
      const all=await owner.query('SELECT actor_id,idempotency_key FROM catalog_private.catalog_import_receipts');
      assert.ok(all.rows.every(r=>r.actor_id===actor || r.actor_id===otherActor),'refuse cleanup of unknown rows');
      await owner.query('DELETE FROM catalog_private.catalog_import_receipts WHERE actor_id=ANY($1::text[])',[[actor,otherActor]]);
      if(rolesCreated){
        for(const name of Object.values(roles)){
          const exists=await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name]);
          if(exists.rowCount)await owner.query(`DROP ROLE ${name}`);
        }
      }
      const final=await owner.query(`SELECT
        (SELECT count(*)::int FROM catalog_private.products) products,
        (SELECT count(*)::int FROM catalog_private.product_variants) variants,
        (SELECT count(*)::int FROM catalog_private.categories) categories,
        (SELECT count(*)::int FROM catalog_private.product_categories) product_categories,
        (SELECT count(*)::int FROM catalog_private.product_images) images,
        (SELECT count(*)::int FROM catalog_private.product_translations) translations,
        (SELECT count(*)::int FROM catalog_private.catalog_import_receipts) receipts,
        (SELECT count(*)::int FROM pg_namespace WHERE nspname ILIKE '%rfq%') rfq`);
      assert.ok(Object.values(final.rows[0]).every(v=>v===0));
      console.log('FINAL ROWS',JSON.stringify(final.rows[0]));
      mark('approved-target cleanup and zero-row final state');
    }
  } finally {if(owner._connected)await owner.end();}
}
console.log(`RESULT ${marks.length} stages passed`);
