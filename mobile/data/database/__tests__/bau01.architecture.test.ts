import { TYPE_CATALOG_KEYS, UNKNOWN_ENTITY_TYPE } from '@/domain/constants';
import { initializeDatabase } from '@/data/database/initialize';
import {
  DATABASE_MIGRATIONS,
  LATEST_DATABASE_VERSION,
  migrateDatabase,
} from '@/data/database/migrations';
import { createRepositories } from '@/data/repositories/createRepositories';
import { createTestDatabase } from '@/test/sqliteTestDatabase';

describe('BAU-01 architecture contract', () => {
  it('preserves provenance and original source while refining an unknown entity', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    await initializeDatabase(db);
    const repositories = createRepositories(db);

    const captured = await repositories.captures.captureUnknownText({
      text: 'Seriennummer aus der Originalnotiz: SN-42',
      title: 'Unbekanntes Gerät',
    });
    expect(captured.entity.type).toBe(UNKNOWN_ENTITY_TYPE);
    expect(captured.source.isUserConfirmed).toBe(true);

    const refined = await repositories.entities.refine(captured.entity.id, {
      type: 'device.router',
      title: 'Wohnzimmer-Router',
    });
    const sources = await repositories.sources.findForRecord(refined.id);
    const provenance = await repositories.sources.findProvenance(refined.id);

    expect(refined.id).toBe(captured.entity.id);
    expect(refined.type).toBe('device.router');
    expect(refined.isPlaceholder).toBe(false);
    expect(refined.description).toBe(captured.entity.description);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.metadata.originalText).toBe(
      'Seriennummer aus der Originalnotiz: SN-42',
    );
    expect(sources[0]?.isUserConfirmed).toBe(true);
    expect(provenance[0]?.sourceId).toBe(captured.source.id);

    await db.closeAsync();
  });

  it('supports dynamic attributes, types, relationships, aliases, privacy and export', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);

    const source = await repositories.sources.create({
      id: 'source_test_original',
      type: 'document',
      title: 'Originaldokument',
      isUserConfirmed: true,
      metadata: { originalContent: 'Unveränderter Quellinhalt' },
    });
    const first = await repositories.entities.create({
      id: 'entity_test_first',
      type: 'person',
      title: 'Ada Beispiel',
      provenanceIds: [source.id],
    });
    const second = await repositories.entities.create({
      id: 'entity_test_second',
      type: 'organization.custom',
      title: 'Offene Organisation',
    });

    await repositories.entities.addAttribute(first.id, {
      id: 'attribute_test_custom',
      key: 'custom.favorite.protocol',
      valueType: 'custom.scalar',
      value: { value: 'GraphQL', unit: 'preference' },
      provenanceIds: [source.id],
    });
    const attributes = await repositories.entities.findAttributes(first.id);
    expect(attributes[0]?.value).toEqual({ value: 'GraphQL', unit: 'preference' });
    expect(attributes[0]?.provenanceIds).toEqual([source.id]);

    const eventType = await repositories.vocabularies.addTerm({
      id: 'term_test_future_event',
      vocabularyKey: TYPE_CATALOG_KEYS.EVENT,
      code: 'future.event.type',
      label: 'Zukünftiges Ereignis',
    });
    const event = await repositories.events.create({
      id: 'event_test_future',
      type: eventType.code,
      title: 'Dynamisches Ereignis',
      subjectEntityIds: [first.id],
      provenanceIds: [source.id],
    });
    expect((await repositories.events.findForEntity(first.id))[0]).toMatchObject({
      id: event.id,
      type: 'future.event.type',
      provenanceIds: [source.id],
    });
    await expect(
      repositories.events.create({
        id: 'event_test_invalid_range',
        type: eventType.code,
        title: 'Ungültiger Zeitraum',
        occurredAt: '2025-02-02T10:00:00.000Z',
        endedAt: '2025-02-01T10:00:00.000Z',
      }),
    ).rejects.toThrow('event end');

    const catalogTerm = await repositories.vocabularies.addTerm({
      id: 'term_test_future_domain',
      vocabularyKey: TYPE_CATALOG_KEYS.ENTITY,
      code: 'future.life.domain',
      label: 'Zukünftiger Lebensbereich',
    });
    expect(catalogTerm.code).toBe('future.life.domain');

    const relationshipType = await repositories.relationships.createType({
      id: 'relationship_type_test_mentors',
      key: 'custom.mentors',
      label: 'Mentoriert',
    });
    const relationship = await repositories.relationships.create({
      id: 'relationship_test_mentors',
      type: relationshipType.key,
      typeDefinitionId: relationshipType.id,
      sourceEntityId: first.id,
      targetEntityId: second.id,
      provenanceIds: [source.id],
    });
    expect((await repositories.relationships.findForEntity(first.id))[0]).toMatchObject({
      id: relationship.id,
      type: 'custom.mentors',
      targetEntityId: second.id,
      provenanceIds: [source.id],
    });

    await repositories.aliases.create({
      id: 'alias_test_personal',
      entityId: first.id,
      value: 'Mein persönlicher Name für Ada',
      provenanceIds: [source.id],
    });
    const aliases = await repositories.aliases.findForEntity(first.id);
    const unchangedSource = (await repositories.sources.findForRecord(first.id))[0];
    expect(aliases[0]?.value).toBe('Mein persönlicher Name für Ada');
    expect(unchangedSource?.metadata.originalContent).toBe('Unveränderter Quellinhalt');

    const privacy = await repositories.privacy.reclassify(first.id, {
      classification: 'HIGHLY_SENSITIVE',
      reason: 'Architekturtest',
      classifiedBy: 'user',
      handlingRules: ['no_cloud_ai'],
    });
    expect(privacy.classification).toBe('HIGHLY_SENSITIVE');
    expect((await repositories.entities.getById(first.id))?.privacy).toMatchObject({
      classification: 'HIGHLY_SENSITIVE',
      reason: 'Architekturtest',
      classifiedBy: 'user',
      handlingRules: ['no_cloud_ai'],
    });

    const details = await repositories.entities.getDetails(first.id);
    expect(details).toMatchObject({
      entity: { id: first.id },
      attributes: [{ id: 'attribute_test_custom' }],
      aliases: [{ id: 'alias_test_personal' }],
      relationships: [{ id: relationship.id }],
      events: [{ id: event.id }],
      sources: [{ id: source.id }],
    });

    const bundle = await repositories.exports.buildCoreBundle();
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.tables.entities?.some((row) => row.id === first.id)).toBe(true);
    expect(bundle.tables.attribute_values?.some((row) => row.entity_id === first.id)).toBe(true);
    expect(bundle.tables.relationships?.some((row) => row.id === relationship.id)).toBe(true);
    expect(bundle.tables.events?.some((row) => row.id === event.id)).toBe(true);
    expect(bundle.tables.sources?.some((row) => row.id === source.id)).toBe(true);
    expect(bundle.tables.aliases?.some((row) => row.entity_id === first.id)).toBe(true);
    expect(
      bundle.tables.record_provenance_links?.some(
        (row) => row.record_id === first.id && row.source_id === source.id,
      ),
    ).toBe(true);

    await db.closeAsync();
  });

  it.each([1, 2, 3, 4, 5])('upgrades a valid historical schema from version %i', async (version) => {
    const db = await createTestDatabase();
    for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version <= version)) {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        '2025-01-01T00:00:00.000Z',
      );
    }
    await db.execAsync(`PRAGMA user_version = ${version};`);

    await migrateDatabase(db);

    const current = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const audit = await db.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(current?.user_version).toBe(LATEST_DATABASE_VERSION);
    expect(audit.map((row) => row.version)).toEqual(
      DATABASE_MIGRATIONS.map((migration) => migration.version),
    );
    await db.closeAsync();
  });

  it('rejects inconsistent migration markers instead of skipping schema work', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    await db.execAsync('PRAGMA user_version = 2;');

    await expect(migrateDatabase(db)).rejects.toThrow('Migrationshistorie');

    await db.closeAsync();
  });
});
