import { CreateTableCommand, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { ENVIRONMENTS, type AuditEntry, type Environment, type EnvironmentConfig, type Flag, type FlagWithConfigs, type Segment } from '@flagship/shared';
import { changedMeanwhile } from '../errors.js';
import type { AuditFilter, NewAuditEntry } from '../repositories/audit.js';
import type { Store, Write } from './store.js';

/*
 * One table, keyed by (pk, sk). Entities are stored as JSON in `data`, as in SQLite: DynamoDB maps don't keep key
 * order, and clients compare configs by their JSON.
 *   meta  / revision                  { n }: id of the latest audit entry
 *   state / flag#<key>                { data: Flag, updatedAt }: updatedAt apart, so a config save can touch it alone
 *   state / config#<flagKey>#<env>    { flagKey, environment, data: EnvironmentConfig }
 *   state / segment#<key>             { data: Segment }
 *   audit / <id, zero-padded>         { data: AuditEntry, flagKey, actorId, environment, operation } (filter fields)
 */

type Item = Record<string, any>;
type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

interface State {
  revision: number;
  flags: FlagWithConfigs[];
  segments: Segment[];
}

const REVISION_KEY = { pk: 'meta', sk: 'revision' };
const flagKey = (key: string) => ({ pk: 'state', sk: `flag#${key}` });
const configKey = (key: string, environment: Environment) => ({ pk: 'state', sk: `config#${key}#${environment}` });
const segmentKey = (key: string) => ({ pk: 'state', sk: `segment#${key}` });
const auditKey = (id: number) => ({ pk: 'audit', sk: String(id).padStart(12, '0') });
// Binary order, as SQLite's ORDER BY.
const by = <T>(field: (t: T) => string) => (a: T, b: T) => (field(a) < field(b) ? -1 : field(a) > field(b) ? 1 : 0);

export function dynamoClient(endpoint?: string): DynamoDBDocumentClient {
  const local = endpoint ? { endpoint, region: 'local', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {};
  return DynamoDBDocumentClient.from(new DynamoDBClient(local), { marshallOptions: { removeUndefinedValues: true } });
}

/** For DynamoDB Local; on AWS the table comes from the CDK stack. */
export async function createTable(client: DynamoDBDocumentClient, TableName: string): Promise<void> {
  await client.send(new CreateTableCommand({
    TableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
  }));
}

/**
 * DynamoDB-backed store. Flags, configs and segments are small, so they are read as one cached state that is
 * re-read only when the revision changes; every read still checks the revision, so other instances' writes show up.
 * Commits are one transaction that also moves the revision on, conditional on it being unchanged.
 */
export class DynamoStore implements Store {
  private cache?: State;
  private pending?: Promise<State>;

  constructor(private readonly client: DynamoDBDocumentClient, private readonly table: string) {}

  async revision() {
    return (await this.state()).revision;
  }

  async getFlag(key: string) {
    const flag = await this.getFlagWithConfigs(key);
    if (!flag) return null;
    const { environments: _environments, ...rest } = flag;
    return rest;
  }

  async listFlagsWithConfigs() {
    return structuredClone((await this.state()).flags);
  }

  async getFlagWithConfigs(key: string) {
    const flag = (await this.state()).flags.find((f) => f.key === key);
    return flag ? structuredClone(flag) : null;
  }

  async listSegments() {
    return structuredClone((await this.state()).segments);
  }

  async getSegment(key: string) {
    const segment = (await this.state()).segments.find((s) => s.key === key);
    return segment ? structuredClone(segment) : null;
  }

  async listAudit(filter: AuditFilter = {}) {
    const limit = filter.limit ?? 100;
    const conditions: string[] = [];
    const values: Item = { ':pk': 'audit' };
    for (const field of ['flagKey', 'actorId', 'environment', 'operation'] as const) {
      if (filter[field]) {
        conditions.push(`${field} = :${field}`);
        values[`:${field}`] = filter[field];
      }
    }
    // shortcut: a filtered list pages through the newest entries until it has enough; fine while the nightly reset keeps the log short.
    const entries: AuditEntry[] = [];
    let ExclusiveStartKey: Item | undefined;
    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: conditions.length ? conditions.join(' AND ') : undefined,
        ExpressionAttributeValues: values,
        ScanIndexForward: false,
        ConsistentRead: true,
        Limit: limit,
        ExclusiveStartKey,
      }));
      entries.push(...(page.Items ?? []).map((item) => JSON.parse(item.data) as AuditEntry));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey && entries.length < limit);
    return entries.slice(0, limit);
  }

  async getAudit(id: number) {
    const { Item } = await this.client.send(new GetCommand({ TableName: this.table, Key: auditKey(id), ConsistentRead: true }));
    return Item ? (JSON.parse(Item.data) as AuditEntry) : null;
  }

  async commit(writes: Write[], audit: NewAuditEntry, revision: number) {
    const id = revision + 1;
    const entry: AuditEntry = {
      id, timestamp: audit.timestamp, actorId: audit.actor.id, actorName: audit.actor.name, actorRole: audit.actor.role,
      operation: audit.operation, flagKey: audit.flagKey ?? null, segmentKey: audit.segmentKey ?? null,
      environment: audit.environment ?? null, previous: audit.previous, next: audit.next, rollbackOf: audit.rollbackOf ?? null,
    };
    const items: TransactItem[] = [
      { Put: { TableName: this.table, Item: { ...REVISION_KEY, n: id },
        ...(revision === 0 ? { ConditionExpression: 'attribute_not_exists(pk)' } : { ConditionExpression: 'n = :revision', ExpressionAttributeValues: { ':revision': revision } }) } },
      { Put: { TableName: this.table, ConditionExpression: 'attribute_not_exists(pk)', Item: {
        ...auditKey(id), data: JSON.stringify(entry), flagKey: entry.flagKey, actorId: entry.actorId, environment: entry.environment, operation: entry.operation,
      } } },
    ];
    // A transaction may touch each item once, so a flag's put and its putConfig touches are merged into one operation.
    const flagOps = new Map<string, TransactItem>();
    for (const write of writes) {
      switch (write.type) {
        case 'putFlag':
          flagOps.set(write.flag.key, { Put: { TableName: this.table, Item: { ...flagKey(write.flag.key), data: JSON.stringify(write.flag), updatedAt: write.flag.updatedAt } } });
          break;
        case 'putConfig': {
          const { flag, environment, config, timestamp } = write;
          items.push({ Put: { TableName: this.table, Item: { ...configKey(flag.key, environment), flagKey: flag.key, environment, data: JSON.stringify(config) } } });
          const put = flagOps.get(flag.key)?.Put;
          if (put?.Item) put.Item.updatedAt = timestamp;
          else flagOps.set(flag.key, { Update: { TableName: this.table, Key: flagKey(flag.key), UpdateExpression: 'SET updatedAt = :t',
            ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':t': timestamp } } });
          break;
        }
        case 'putSegment':
          items.push({ Put: { TableName: this.table, Item: { ...segmentKey(write.segment.key), data: JSON.stringify(write.segment) } } });
          break;
        case 'deleteSegment':
          items.push({ Delete: { TableName: this.table, Key: segmentKey(write.segment.key) } });
          break;
      }
    }
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [...items, ...flagOps.values()] }));
    } catch (error) {
      const reasons = error instanceof TransactionCanceledException ? error.CancellationReasons ?? [] : [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed' || reasons.some((r) => r.Code === 'TransactionConflict')) throw changedMeanwhile();
      throw error;
    }
    this.pending = undefined; // a read started before this commit must not answer reads made after it
    return id;
  }

  private state(): Promise<State> {
    return (this.pending ??= this.readState().finally(() => (this.pending = undefined)));
  }

  private async readState(): Promise<State> {
    let revision = await this.readRevision();
    if (this.cache?.revision === revision) return this.cache;
    // A query isn't a snapshot: re-check the revision after it, and that every flag has its configs,
    // so a commit landing midway is never cached half-applied.
    for (let attempt = 0; attempt < 5; attempt++) {
      const items = await this.queryAll('state');
      const after = await this.readRevision();
      const state = after === revision ? toState(revision, items) : null;
      if (state) return (this.cache = state);
      revision = after;
    }
    throw new Error('Flagship could not read a consistent state: it kept changing, or a flag is missing its configs.');
  }

  private async readRevision(): Promise<number> {
    const { Item } = await this.client.send(new GetCommand({ TableName: this.table, Key: REVISION_KEY, ConsistentRead: true }));
    return Item?.n ?? 0;
  }

  private async queryAll(pk: string): Promise<Item[]> {
    const items: Item[] = [];
    let ExclusiveStartKey: Item | undefined;
    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.table, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': pk }, ConsistentRead: true, ExclusiveStartKey,
      }));
      items.push(...(page.Items ?? []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }
}

function toState(revision: number, items: Item[]): State | null {
  const flags: Flag[] = [];
  const segments: Segment[] = [];
  const configs = new Map<string, Partial<Record<Environment, EnvironmentConfig>>>();
  for (const item of items) {
    if (item.sk.startsWith('flag#')) flags.push({ ...JSON.parse(item.data), updatedAt: item.updatedAt });
    else if (item.sk.startsWith('segment#')) segments.push(JSON.parse(item.data));
    else configs.set(item.flagKey, { ...configs.get(item.flagKey), [item.environment]: JSON.parse(item.data) });
  }
  if (flags.some((f) => ENVIRONMENTS.some((env) => !configs.get(f.key)?.[env]))) return null;
  return {
    revision,
    flags: flags.sort(by((f) => f.key)).map((flag) => ({
      ...flag, environments: Object.fromEntries(ENVIRONMENTS.map((env) => [env, configs.get(flag.key)![env]])) as Record<Environment, EnvironmentConfig>,
    })),
    segments: segments.sort(by((s) => s.name)),
  };
}
