import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import serverless from 'serverless-http';
import { createApp } from './app.js';
import { apiGatewaySender, ConnectionPublisher, Connections } from './aws/connections.js';
import { DYNAMODB_ENDPOINT, LIVE_CALLBACK_URL, PRODUCTION_READ_ONLY, STORAGE, TABLE_NAME } from './config.js';
import { resetDynamo } from './database/dynamo-reset.js';
import { dynamoClient, DynamoStore } from './database/dynamo-store.js';

// AWS Lambda entry points (one bundle, three functions). Never imports the SQLite code.
if (STORAGE !== 'dynamodb') throw new Error('The Lambda handlers need STORAGE=dynamodb.');
if (!LIVE_CALLBACK_URL) throw new Error('The Lambda handlers need LIVE_CALLBACK_URL.');

const client = dynamoClient(DYNAMODB_ENDPOINT);
const connections = new Connections(client, TABLE_NAME);

/** HTTP API: the Express app. Each warm instance keeps its store cache between requests. */
export const api = serverless(createApp({
  store: new DynamoStore(client, TABLE_NAME),
  notifier: new ConnectionPublisher(connections, apiGatewaySender(LIVE_CALLBACK_URL)),
  now: () => new Date(),
  productionReadOnly: PRODUCTION_READ_ONLY,
}));

/** WebSocket API $connect and $disconnect. API Gateway answers pings itself (a mock route), without a Lambda. */
export async function live(event: APIGatewayProxyWebsocketEventV2): Promise<{ statusCode: number }> {
  const { routeKey, connectionId } = event.requestContext;
  if (routeKey === '$connect') return { statusCode: (await connections.add(connectionId)) ? 200 : 429 };
  if (routeKey === '$disconnect') await connections.remove(connectionId);
  return { statusCode: 200 };
}

/** Nightly reset (EventBridge Scheduler), and the first seed after a deploy. */
export async function reset(): Promise<void> {
  await resetDynamo(client, TABLE_NAME);
}
