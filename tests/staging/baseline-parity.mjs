import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const normalize = value => value == null ? null : String(value).replaceAll('\r\n', '\n')
  .replace(/nextval\('public\./g, "nextval('").replace(/\bpublic\.(handle_new_user|borrar_archivo_storage_al_limpiar)\(/g, '$1(')
  .replace(/\s+/g, ' ').trim();
const sorted = rows => rows.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

function aclItems(value) {
  return (value ?? '{}').slice(1, -1).split(',').filter(Boolean).map(item => {
    const match = /^([^=]*)=([^/]*)\/(.*)$/.exec(item);
    assert(match, 'Catalog ACL must have PostgreSQL aclitem form');
    const permissions = [];
    for (let index = 0; index < match[2].length; index++) {
      const privilege = match[2][index];
      assert.notEqual(privilege, '*');
      const grantable = match[2][index + 1] === '*';
      permissions.push(privilege + (grantable ? '*' : ''));
      if (grantable) index++;
    }
    return { grantee: match[1] || 'PUBLIC', permissions: permissions.sort().join(''), grantor: match[3] };
  });
}

export async function verifyBaselineParity(db, catalog) {
  const expected = catalog.metadata;
  const client = await db.connect();
  let actual;
  try {
    await client.query('begin');
    await client.query("set local search_path=public,extensions");
    actual = (await client.query(`select jsonb_build_object(
      'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
        'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
          'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum)
          from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
        'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid,true),
          'deferrable',condeferrable,'initially_deferred',condeferred,'validated',convalidated) order by conname),'[]'::jsonb) from pg_constraint where conrelid=c.oid),
        'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(indexrelid) order by indexrelid::regclass::text),'[]'::jsonb) from pg_index where indrelid=c.oid),
        'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid,true)) order by tgname),'[]'::jsonb)
          from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
      'function_inventory',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
        'kind',p.prokind,'owner',pg_get_userbyid(p.proowner),'definition_sha256',case when p.prokind in ('f','p') then
          encode(extensions.digest(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n'),'sha256'),'hex') else null end)
        order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
      'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid)) order by p.proname)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
        and p.proname in ('handle_new_user','limpiar_evidencias_antiguas','borrar_archivo_storage_al_limpiar')),
      'policies',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,
        'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
        from pg_policies where schemaname in ('public','storage')),
      'relations_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'kind',c.relkind,'owner',owner_role.rolname,
        'grantor',grantor.rolname,'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee.rolname end,'privilege',acl.privilege_type,'grantable',acl.is_grantable)
        order by n.nspname,c.relname,acl.grantee,acl.privilege_type)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles owner_role on owner_role.oid=c.relowner
        cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) acl
        left join pg_roles grantor on grantor.oid=acl.grantor left join pg_roles grantee on grantee.oid=acl.grantee
        where (n.nspname='public' and c.relkind in ('r','p','S')) or (n.nspname='storage' and c.relname in ('objects','buckets'))),
      'functions_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
        'owner',owner_role.rolname,'grantor',grantor.rolname,'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee.rolname end,
        'privilege',acl.privilege_type,'grantable',acl.is_grantable) order by p.proname,acl.grantee,acl.privilege_type)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles owner_role on owner_role.oid=p.proowner
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f'::"char",p.proowner))) acl
        left join pg_roles grantor on grantor.oid=acl.grantor left join pg_roles grantee on grantee.oid=acl.grantee
        where n.nspname='public' and p.proname in ('handle_new_user','limpiar_evidencias_antiguas','borrar_archivo_storage_al_limpiar')),
      'schemas_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee.rolname end,
        'privilege',acl.privilege_type,'grantable',acl.is_grantable) order by n.nspname,acl.grantee,acl.privilege_type)
        from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n'::"char",n.nspowner))) acl
        left join pg_roles grantee on grantee.oid=acl.grantee where n.nspname in ('public','storage')),
      'default_acl',(select jsonb_agg(jsonb_build_object('owner',r.rolname,'schema',n.nspname,'kind',d.defaclobjtype,'acl',d.defaclacl::text)
        order by r.rolname,d.defaclobjtype) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
        join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'),
      'sequences',(select jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(s.seqtypid,null),'start',s.seqstart,'increment',s.seqincrement,
        'max',s.seqmax,'min',s.seqmin,'cache',s.seqcache,'cycle',s.seqcycle,'acl',c.relacl::text) order by c.relname)
        from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
      ) as metadata`)).rows[0].metadata;
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }

  const tableProjection = table => ({ name: table.name, rls: table.rls, force_rls: table.force_rls,
    columns: table.columns.map(column => ({ ...column, default: normalize(column.default) })),
    constraints: table.constraints.map(item => ({ ...item, definition: normalize(item.definition) })),
    indexes: table.indexes.map(normalize), triggers: table.triggers.map(item => ({ ...item, definition: normalize(item.definition) })) });
  assert.deepEqual(actual.tables.map(tableProjection), expected.public_tables.map(tableProjection), 'Full public table/column/default/identity/constraint/index/trigger parity');
  const functionProjection = rows => rows.map(item => ({ name: item.name, definition: normalize(item.definition) }));
  assert(expected.application_function_inventory, 'Fresh complete non-extension function inventory is required');
  assert.deepEqual(actual.function_inventory, expected.application_function_inventory, 'All non-extension public application functions/signatures/definition hashes must match');
  assert.deepEqual(functionProjection(actual.functions), functionProjection(expected.legacy_functions), 'Legacy function-definition parity');
  const policyProjection = rows => rows.map(row => ({ ...row, roles: [...row.roles].sort(), using: normalize(row.using), check: normalize(row.check) }));
  // Public is application-owned: an unexpected permissive policy must fail.
  // Only additional managed Storage policies are outside this projection.
  const actualApplicationPolicies = actual.policies.filter(row => row.schema === 'public' ||
    expected.policies.some(item => item.schema === row.schema && item.table === row.table && item.name === row.name));
  assert.deepEqual(policyProjection(actualApplicationPolicies), policyProjection(expected.policies), 'Application policy predicates/roles/permissiveness parity');

  const projection = { tables: actual.tables.map(tableProjection), functions: functionProjection(actual.functions), functionInventory: actual.function_inventory,
    policies: policyProjection(actualApplicationPolicies) };
  const grants = expected.catalog_acls;
  assert(grants?.relations?.length && grants.functions?.length, 'Fresh pg_catalog ACL capture is required');
  // Application-owned public grants must match exactly. Platform Storage grants
  // can evolve with its image and are recorded separately from application DDL.
  const publicRelations = rows => sorted(rows.filter(row => row.schema === 'public'));
  assert.deepEqual(publicRelations(actual.relations_acl), publicRelations(grants.relations), 'Public table/sequence ACL parity');
  assert.deepEqual(sorted(actual.functions_acl), sorted(grants.functions), 'Application function ACL parity');
  const publicSchemas = rows => sorted(rows.filter(row => row.schema === 'public'));
  assert.deepEqual(publicSchemas(actual.schemas_acl), publicSchemas(grants.schemas), 'Public schema ACL parity');
  const defaultProjection = rows => sorted(rows.map(row => ({ ...row, acl: sorted(aclItems(row.acl)) })));
  assert.deepEqual(defaultProjection(actual.default_acl), defaultProjection(expected.default_grants), 'All public default ACLs, including supabase_admin, preserved');
  const sequenceProjection = rows => rows.map(row => ({ ...row, acl: sorted(aclItems(row.acl)) }));
  assert.deepEqual(sequenceProjection(actual.sequences), sequenceProjection(expected.sequences), 'Sequence configuration and ACL parity');
  Object.assign(projection, { relationsAcl: publicRelations(actual.relations_acl), functionsAcl: sorted(actual.functions_acl),
    schemaAcl: publicSchemas(actual.schemas_acl), defaultAcl: defaultProjection(actual.default_acl), sequences: sequenceProjection(actual.sequences) });
  return { matched: true, publicTables: actual.tables.length,
    columns: actual.tables.reduce((total, table) => total + table.columns.length, 0),
    compared: ['columns_types_nullability_defaults_identity', 'constraints', 'indexes', 'triggers', 'function_definitions',
      'policy_predicates_roles_permissiveness', 'public_table_sequence_function_schema_acl', 'default_acl', 'sequence_configuration'],
    actualApplicationFingerprintSha256: createHash('sha256').update(JSON.stringify(canonical(projection))).digest('hex'),
    platformStorageAcl: { actual: actual.relations_acl.filter(row => row.schema === 'storage'), productionReference: grants.relations.filter(row => row.schema === 'storage') },
    managedStoragePolicyExtras: actual.policies.filter(row => row.schema === 'storage' &&
      !expected.policies.some(item => item.schema === row.schema && item.table === row.table && item.name === row.name)),
    platformStorageAclMatchRequired: false };
}
