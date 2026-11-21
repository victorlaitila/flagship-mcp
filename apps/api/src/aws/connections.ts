import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DeleteCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ChangeEvent, LiveMessage } from '@flagship/shared';
import type { ChangePublisher } from '../events.js';

/** Open live connections allowed at once: API Gateway bills each by the minute. */
export const MAX_CONNECTIONS = 20;
/** API Gateway closes connections after 2 hours, so a connection whose $disconnect never arrived stops counting then. */
const CONNECTION_LIFETIME_S = 2 * 60 * 60;

const connectionKey = (id: string) => ({ pk: 'connection', sk: id });

/** Open WebSocket connections, stored in the Flagship table (pk `connection`, `expiresAt` also set as the table's TTL). */
export class Connections {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly table: string, private readonly now = () => Date.now()) {}

  /** Registers a connection unless the cap is reached; returns whether it was accepted. */
  async add(id: string): Promise<boolean> {
    // shortcut: count-then-put lets simultaneous connects overshoot the cap by a few (bounded by Lambda concurrency); fine as a cost cap.
    if ((await this.list()).length >= MAX_CONNECTIONS) return false;
    const expiresAt = Math.floor(this.now() / 1000) + CONNECTION_LIFETIME_S;
    await this.client.send(new PutCommand({ TableName: this.table, Item: { ...connectionKey(id), expiresAt } }));
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.table, Key: connectionKey(id) }));
  }

  async list(): Promise<string[]> {
    const ids: string[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'expiresAt > :now', // TTL deletion can lag by days
        ExpressionAttributeValues: { ':pk': 'connection', ':now': Math.floor(this.now() / 1000) },
        ConsistentRead: true,
        ExclusiveStartKey,
      }));
      ids.push(...(page.Items ?? []).map((item) => item.sk as string));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return ids;
  }
}

export type SendToConnection = (connectionId: string, data: string) => Promise<void>;

export function apiGatewaySender(callbackUrl: string): SendToConnection {
  const client = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });
  return async (connectionId, data) => {
    await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
  };
}

/** Sends each change to every open connection; connections API Gateway reports as gone are removed. */
export class ConnectionPublisher implements ChangePublisher {
  constructor(private readonly connections: Connections, private readonly send: SendToConnection) {}

  async publish(event: ChangeEvent): Promise<void> {
    const data = JSON.stringify({ type: 'change', event } satisfies LiveMessage);
    await Promise.all((await this.connections.list()).map(async (id) => {
      try {
        await this.send(id, data);
      } catch (error) {
        if ((error as Error).name === 'GoneException') await this.connections.remove(id);
        else console.error(`Sending a change to connection ${id} failed`, error);
      }
    }));
  }
}
