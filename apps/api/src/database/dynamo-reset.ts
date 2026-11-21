import { BatchWriteCommand, QueryCommand, type BatchWriteCommandOutput, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AppError } from '../errors.js';
import { DynamoStore, REVISION_KEY } from './dynamo-store.js';
import { seed } from './seed.js';

/**
 * Deletes flags, configs, segments and the audit log and seeds again; open live connections stay.
 * The revision only ever moves forward: a reused number would let a warm instance trust its pre-reset cache.
 */
export async function resetDynamo(client: DynamoDBDocumentClient, table: string, now = Date.now()): Promise<void> {
  const bump = () => client.send(new UpdateCommand({
    TableName: table, Key: REVISION_KEY, UpdateExpression: 'ADD n :one', ExpressionAttributeValues: { ':one': 1 },
  }));
  for (let attempt = 1; ; attempt++) {
    try {
      await bump(); // writes checked against the old data now fail, and every cache is re-read
      await deleteAll(client, table, 'state');
      await deleteAll(client, table, 'audit');
      await bump(); // and again for writes checked while items were being deleted
      await seed(new DynamoStore(client, table), now);
      return;
    } catch (error) {
      // A visitor's write landed between the deletes and the seed: start over.
      if (attempt >= 3 || !(error instanceof AppError && error.code === 'CONFLICT')) throw error;
    }
  }
}

async function deleteAll(client: DynamoDBDocumentClient, table: string, pk: string): Promise<void> {
  const keys: Record<string, string>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(new QueryCommand({
      TableName: table, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: 'pk, sk', ConsistentRead: true, ExclusiveStartKey,
    }));
    keys.push(...(page.Items ?? []) as Record<string, string>[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  // Flags before their configs, in separate batches (a batch has no order): a flag without configs makes the state
  // unreadable, while configs without a flag are ignored.
  const isFlag = (key: Record<string, string>) => key.sk.startsWith('flag#');
  for (const group of [keys.filter(isFlag), keys.filter((key) => !isFlag(key))]) {
    for (let i = 0; i < group.length; i += 25) {
      let requests: Record<string, any>[] | undefined = group.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      while (requests?.length) {
        const result: BatchWriteCommandOutput = await client.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
        requests = result.UnprocessedItems?.[table];
        if (requests?.length) await new Promise((resolve) => setTimeout(resolve, 500)); // throttled: let capacity refill
      }
    }
  }
}
