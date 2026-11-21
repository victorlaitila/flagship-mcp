import { ApiGatewayV2Client, GetApisCommand, UpdateStageCommand } from '@aws-sdk/client-apigatewayv2';
import { DeleteFunctionConcurrencyCommand, LambdaClient, PutFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';

/** What to stop and how to restore it; set by the stack (`KILL_SWITCH_CONFIG`). Targets are found by name. */
export interface KillSwitchConfig {
  region: string;
  functions: string[];
  /** Reserved concurrency to restore; null when the functions have none. */
  reservedConcurrency: number | null;
  stages: { apiName: string; stageName: string; rateLimit: number; burstLimit: number }[];
}

const config: KillSwitchConfig = JSON.parse(process.env.KILL_SWITCH_CONFIG ?? '');
const lambda = new LambdaClient({ region: config.region });
const apis = new ApiGatewayV2Client({ region: config.region });

/**
 * Budget alarm (via SNS): stops all API and live-update traffic, so spending stops growing.
 * By hand: `npm run demo:stop` and `npm run demo:restore`.
 */
export async function handler(event: { action?: string }): Promise<string> {
  const restore = event?.action === 'restore';
  const { Items = [] } = await apis.send(new GetApisCommand({}));
  const apiId = (name: string) => {
    const api = Items.find((a) => a.Name === name);
    if (!api?.ApiId) throw new Error(`API ${name} not found`);
    return api.ApiId;
  };
  await Promise.all([
    ...config.functions.map((FunctionName) =>
      restore && config.reservedConcurrency === null
        ? lambda.send(new DeleteFunctionConcurrencyCommand({ FunctionName }))
        : lambda.send(new PutFunctionConcurrencyCommand({ FunctionName, ReservedConcurrentExecutions: restore ? config.reservedConcurrency! : 0 }))),
    ...config.stages.map(({ apiName, stageName, rateLimit, burstLimit }) =>
      apis.send(new UpdateStageCommand({
        ApiId: apiId(apiName),
        StageName: stageName,
        DefaultRouteSettings: { ThrottlingRateLimit: restore ? rateLimit : 0, ThrottlingBurstLimit: restore ? burstLimit : 0 },
      }))),
  ]);
  const result = restore ? 'Flagship restored' : 'Flagship stopped by the budget kill switch';
  console.log(result);
  return result;
}
