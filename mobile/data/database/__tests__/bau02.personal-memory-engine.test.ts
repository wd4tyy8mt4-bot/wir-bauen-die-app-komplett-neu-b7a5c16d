import { UNKNOWN_ENTITY_TYPE } from '@/domain/constants';
import { initializeDatabase } from '@/data/database/initialize';
import {
  DATABASE_MIGRATIONS,
  LATEST_DATABASE_VERSION,
  migrateDatabase,
} from '@/data/database/migrations';
import { createRepositories } from '@/data/repositories/createRepositories';
import { createTestDatabase } from '@/test/sqliteTestDatabase';

describe('BAU-02 Personal Memory Engine', () => {
  it('creates, reads and transitions memories without manufacturing confirmation', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);

    const created = await repositories.memories.createMemory({
      id: 'memory_lifecycle',
      content: 'Der Ersatzfilter liegt im Keller.',
      type: 'NOTE',
      confidence: 0.8,
    });

    expect(created).toMatchObject({
      id: 'memory_lifecycle',
      content: 'Der Ersatzfilter liegt im Keller.',
      type: 'NOTE',
      status: 'UNCONFIRMED',
      confidence: 0.8,
      isTemporary: false,
      userConfirmed: false,
      privacy: { classification: 'PRIVATE' },
    });
    expect(await repositories.memories.getMemory(created.id)).toEqual(created);

    const inferred = await repositories.memories.markAsInferred(created.id);
    expect(inferred).toMatchObject({
      status: 'INFERRED',
      userConfirmed: false,
      verifiedAt: undefined,
    });

    const temporary = await repositories.memories.markAsTemporary(created.id);
    expect(temporary).toMatchObject({
      status: 'TEMPORARY',
      isTemporary: true,
      userConfirmed: false,
    });

    const persistent = await repositories.memories.makePersistent(created.id);
    expect(persistent).toMatchObject({ status: 'UNCONFIRMED', isTemporary: false });

    const confirmed = await repositories.memories.confirmMemory(
      created.id,
      '2025-02-01T10:00:00.000Z',
    );
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      userConfirmed: true,
      verifiedAt: '2025-02-01T10:00:00.000Z',
      isTemporary: false,
    });

    const uncertain = await repositories.memories.markAsUncertain(created.id);
    expect(uncertain).toMatchObject({
      status: 'UNCERTAIN',
      userConfirmed: false,
      verifiedAt: undefined,
    });

    await db.closeAsync();
  });

  it('keeps provenance while an unknown entity is refined or replaced', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);

    const capture = await repositories.captures.captureUnknownText({
      text: 'Der Kellerkasten enthält Ersatzteile.',
      title: 'Kellerkasten',
    });
    expect(capture.entity.type).toBe(UNKNOWN_ENTITY_TYPE);

    const memory = await repositories.memories.createMemory({
      id: 'memory_unknown_entity',
      content: 'Dort liegen Ersatzteile.',
      type: 'OBSERVATION',
      entityIds: [capture.entity.id],
      provenanceIds: [capture.source.id],
    });
    expect(memory.entityIds).toEqual([capture.entity.id]);
    expect(memory.provenanceIds).toEqual([capture.source.id]);

    const refined = await repositories.entities.refine(capture.entity.id, {
      type: 'storage.box',
      title: 'Ersatzteilkiste im Keller',
      isPlaceholder: false,
    });
    const afterRefinement = await repositories.memories.getMemory(memory.id);
    expect(refined.id).toBe(capture.entity.id);
    expect(afterRefinement?.entityIds).toEqual([capture.entity.id]);
    expect(afterRefinement?.provenanceIds).toEqual([capture.source.id]);

    const preciseEntity = await repositories.entities.create({
      id: 'entity_precise_box',
      type: 'storage.container',
      title: 'Blaue Ersatzteilkiste',
    });
    const moved = await repositories.memories.moveEntityAttachment(
      memory.id,
      capture.entity.id,
      preciseEntity.id,
    );
    expect(moved.entityIds).toEqual([preciseEntity.id]);
    expect(moved.provenanceIds).toEqual([capture.source.id]);
    expect(await repositories.sources.findForRecord(memory.id)).toEqual([
      expect.objectContaining({ id: capture.source.id }),
    ]);

    await db.closeAsync();
  });

  it('stores contradictions as connected revisions and preserves privacy', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);

    const fridge = await repositories.entities.create({
      id: 'entity_fridge',
      type: 'device',
      title: 'Kühlschrank',
      privacyClassification: 'PROTECTED',
    });
    const firstSource = await repositories.sources.create({
      id: 'source_bosch',
      type: 'user_input',
      title: 'Erste Aussage',
      isUserConfirmed: true,
      privacyClassification: 'PROTECTED',
    });
    const secondSource = await repositories.sources.create({
      id: 'source_siemens',
      type: 'user_input',
      title: 'Korrektur',
      isUserConfirmed: true,
      privacyClassification: 'PROTECTED',
    });

    const original = await repositories.memories.createMemory({
      id: 'memory_bosch',
      content: 'Unser Kühlschrank ist von Bosch.',
      type: 'FACT',
      status: 'CONFIRMED',
      entityIds: [fridge.id],
      provenanceIds: [firstSource.id],
      privacyClassification: 'PROTECTED',
    });
    const correction = await repositories.memories.createRevision(original.id, {
      id: 'memory_siemens',
      content: 'Unser Kühlschrank ist von Siemens.',
      type: 'FACT',
      status: 'UNCONFIRMED',
      relationType: 'CONTRADICTS',
      provenanceIds: [secondSource.id],
    });

    expect(await repositories.memories.getMemory(original.id)).toMatchObject({
      content: 'Unser Kühlschrank ist von Bosch.',
      provenanceIds: [firstSource.id],
      privacy: { classification: 'PROTECTED' },
    });
    expect(correction).toMatchObject({
      content: 'Unser Kühlschrank ist von Siemens.',
      provenanceIds: [secondSource.id],
      privacy: { classification: 'PROTECTED' },
    });
    expect(correction.id).not.toBe(original.id);
    expect(await repositories.memories.listRelations(original.id)).toEqual([
      expect.objectContaining({
        fromMemoryId: correction.id,
        toMemoryId: original.id,
        type: 'CONTRADICTS',
        conflictStatus: 'OPEN',
      }),
    ]);

    const confirmedCorrection = await repositories.memories.confirmMemory(correction.id);
    expect(confirmedCorrection.privacy.classification).toBe('PROTECTED');
    expect((await repositories.memories.getMemory(original.id))?.status).toBe('CONFIRMED');

    await db.closeAsync();
  });

  it('searches local graph context and builds a structured entity snapshot', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);

    const source = await repositories.sources.create({
      id: 'source_snapshot',
      type: 'document',
      title: 'Inventarliste',
    });
    const entity = await repositories.entities.create({
      id: 'entity_storage',
      type: 'storage.container',
      title: 'Blaue Kiste',
      provenanceIds: [source.id],
    });
    await repositories.aliases.create({
      id: 'alias_kellerkasten',
      entityId: entity.id,
      value: 'Kellerkasten',
      kind: 'personal_term',
      provenanceIds: [source.id],
    });
    const event = await repositories.events.create({
      id: 'event_inventory',
      type: 'inventory.check',
      title: 'Inventur im Keller',
      subjectEntityIds: [entity.id],
      provenanceIds: [source.id],
    });
    const secondEntity = await repositories.entities.create({
      id: 'entity_filter',
      type: 'object',
      title: 'Ersatzfilter',
    });
    const relationship = await repositories.relationships.create({
      id: 'relationship_contains',
      type: 'contains',
      sourceEntityId: entity.id,
      targetEntityId: secondEntity.id,
      provenanceIds: [source.id],
    });

    const confirmed = await repositories.memories.createMemory({
      id: 'memory_confirmed',
      content: 'Die blaue Kiste enthält einen Ersatzfilter.',
      type: 'FACT',
      status: 'CONFIRMED',
      entityIds: [entity.id],
      eventIds: [event.id],
      relationshipIds: [relationship.id],
      provenanceIds: [source.id],
      validFrom: '2025-01-01T00:00:00.000Z',
    });
    const inferred = await repositories.memories.createMemory({
      id: 'memory_inferred',
      content: 'Die Kiste könnte Werkzeug enthalten.',
      type: 'OBSERVATION',
      status: 'INFERRED',
      entityIds: [entity.id],
    });
    const temporary = await repositories.memories.createMemory({
      id: 'memory_temporary',
      content: 'Kiste heute prüfen.',
      type: 'REMINDER_CONTEXT',
      status: 'TEMPORARY',
      entityIds: [entity.id],
    });

    expect(await repositories.memories.searchMemories({ search: 'Kellerkasten' })).toEqual([
      expect.objectContaining({ id: confirmed.id }),
      expect.objectContaining({ id: inferred.id }),
      expect.objectContaining({ id: temporary.id }),
    ]);
    expect(await repositories.memories.searchMemories({ search: 'Inventur' })).toEqual([
      expect.objectContaining({ id: confirmed.id }),
    ]);
    expect(await repositories.memories.listMemoriesByStatus('inferred')).toEqual([
      expect.objectContaining({ id: inferred.id, userConfirmed: false }),
    ]);
    expect(await repositories.memories.listMemoriesByType('fact')).toEqual([
      expect.objectContaining({ id: confirmed.id }),
    ]);

    const snapshot = await repositories.memories.buildEntitySnapshot(entity.id);
    expect(snapshot).toMatchObject({
      entity: { id: entity.id },
      confirmedMemories: [{ id: confirmed.id }],
      inferredMemories: [{ id: inferred.id }],
      temporaryMemories: [{ id: temporary.id }],
      aliases: [{ value: 'Kellerkasten' }],
      events: [{ id: event.id }],
      relationships: [{ id: relationship.id }],
      sources: [{ id: source.id }],
    });
    expect(snapshot?.currentMemories.map((memory) => memory.id)).toEqual(
      expect.arrayContaining([confirmed.id, inferred.id]),
    );
    expect(snapshot?.currentMemories.map((memory) => memory.id)).not.toContain(temporary.id);
    expect(snapshot?.provenance.some((link) => link.sourceId === source.id)).toBe(true);

    await db.closeAsync();
  });

  it('migrates v4 data to v5, exports memory tables and preserves foreign keys', async () => {
    const db = await createTestDatabase();

    for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version <= 4)) {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        '2025-01-01T00:00:00.000Z',
      );
    }
    await db.execAsync('PRAGMA user_version = 4;');
    await db.runAsync(
      `INSERT INTO records
        (id, record_kind, created_at, updated_at, local_revision, sync_state)
       VALUES ('entity_v4', 'entity', ?, ?, 1, 'local_only')`,
      '2025-01-01T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z',
    );
    await db.runAsync(
      `INSERT INTO record_privacy
        (record_id, classification, classified_at, handling_rules_json)
       VALUES ('entity_v4', 'PRIVATE', ?, '[]')`,
      '2025-01-01T00:00:00.000Z',
    );
    await db.runAsync(
      `INSERT INTO entities
        (id, type_key, title, metadata_json, is_placeholder)
       VALUES ('entity_v4', 'object', 'Bestehende BAU-01 Entity', '{}', 0)`,
    );

    await migrateDatabase(db);
    const repositories = createRepositories(db);
    const memory = await repositories.memories.createMemory({
      id: 'memory_after_migration',
      content: 'BAU-01-Daten bleiben erhalten.',
      entityIds: ['entity_v4'],
    });
    const exportBundle = await repositories.exports.buildCoreBundle();
    const foreignKeyViolations = await db.getAllAsync<Record<string, unknown>>(
      'PRAGMA foreign_key_check',
    );

    expect(
      (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(LATEST_DATABASE_VERSION);
    expect(
      await db.getFirstAsync<{ title: string }>(
        'SELECT title FROM entities WHERE id = ?',
        'entity_v4',
      ),
    ).toEqual({ title: 'Bestehende BAU-01 Entity' });
    expect(exportBundle.tables.memories?.some((row) => row.id === memory.id)).toBe(true);
    expect(
      exportBundle.tables.memory_entities?.some(
        (row) => row.memory_id === memory.id && row.entity_id === 'entity_v4',
      ),
    ).toBe(true);
    expect(exportBundle.tables.memory_events).toEqual(expect.any(Array));
    expect(exportBundle.tables.memory_relationships).toEqual(expect.any(Array));
    expect(exportBundle.tables.memory_relations).toEqual(expect.any(Array));
    expect(foreignKeyViolations).toEqual([]);

    await db.closeAsync();
  });
});
