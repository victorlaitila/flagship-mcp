import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, TimeZone, type StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CfnIntegration, CfnIntegrationResponse, CfnRoute, CfnRouteResponse, HttpApi, HttpStage, WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { ScheduleExpression, Schedule } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/** Guardrails that cap what anyone can make this stack cost (docs/DECISIONS.md, decision 14 and the AWS deployment). */
export const GUARDRAILS = {
  // API Gateway spreads throttling over many nodes, so at 3/s with burst 10 ordinary page loads (up to 11 parallel
  // requests) were refused at random. Per-visitor limiting is CloudFront's (WAF rate rule, free flat-rate plan).
  httpApi: { rateLimit: 10, burstLimit: 30 },
  // Pings: one per open connection every 20 s, at most 20 connections.
  webSocket: { rateLimit: 5, burstLimit: 10 },
  // The always-free allowance; provisioned capacity is also a hard ceiling on database work.
  tableCapacity: { read: 25, write: 25 },
  monthlyBudgetUsd: 1,
  logRetention: RetentionDays.ONE_WEEK,
};

/** Fixed names, so the kill switch (another region: Budgets exists only in us-east-1) can find them. */
export const NAMES = {
  apiFunction: 'flagship-api', liveFunction: 'flagship-live', httpApi: 'flagship-http', liveApi: 'flagship-live', liveStage: 'live',
  killSwitch: 'flagship-kill-switch', // `npm run demo:stop` / `demo:restore` (infra/scripts/demo.mjs)
};

export interface FlagshipStackProps extends StackProps {
  /** Reserved concurrency per function; null where the account's quota leaves none to reserve. */
  reservedConcurrency: number | null;
  /** The built web app. */
  webDist?: string;
  /** The WAF web ACL the CloudFront free flat-rate plan attached (per-IP rate limiting); kept so deploys don't detach it. */
  webAclArn?: string;
  /** Custom domain, with its ACM certificate (us-east-1, DNS-validated at the domain's DNS provider). */
  domain?: { name: string; certificateArn: string };
}

export class FlagshipStack extends Stack {
  constructor(scope: Construct, id: string, props: FlagshipStackProps) {
    super(scope, id, props);
    const webDist = props.webDist ?? root('apps/web/dist');
    if (!existsSync(`${webDist}/index.html`)) throw new Error('Build the web app first (npm run build).');

    const table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PROVISIONED,
      readCapacity: GUARDRAILS.tableCapacity.read,
      writeCapacity: GUARDRAILS.tableCapacity.write,
      timeToLiveAttribute: 'expiresAt', // live connections
      removalPolicy: RemovalPolicy.DESTROY, // demo data, re-seeded nightly
    });

    const fn = (name: string, handler: string, extra: Partial<NodejsFunctionProps> = {}) => new NodejsFunction(this, name, {
      entry: root('apps/api/src/lambda.ts'),
      handler,
      projectRoot: root(''),
      depsLockFilePath: root('package-lock.json'),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: props.reservedConcurrency ?? undefined,
      logGroup: new LogGroup(this, `${name}Logs`, { retention: GUARDRAILS.logRetention, removalPolicy: RemovalPolicy.DESTROY }),
      bundling: {
        format: OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        // CommonJS dependencies (serverless-http) need require() inside the ESM bundle.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      ...extra,
      environment: {
        STORAGE: 'dynamodb',
        TABLE_NAME: table.tableName,
        PRODUCTION_READ_ONLY: 'true',
        NODE_OPTIONS: '--enable-source-maps',
        ...extra.environment,
      },
    });

    // Live updates: WebSocket API. Pings are answered by API Gateway itself (mock), so they cost no Lambda time.
    const live = new WebSocketApi(this, 'Live', { apiName: NAMES.liveApi, routeSelectionExpression: '$request.body.type' });
    const liveStage = new WebSocketStage(this, 'LiveStage', {
      webSocketApi: live, stageName: NAMES.liveStage, autoDeploy: true, throttle: GUARDRAILS.webSocket,
    });
    const liveFn = fn('LiveFn', 'live', {
      functionName: NAMES.liveFunction, timeout: Duration.seconds(5), environment: { LIVE_CALLBACK_URL: liveStage.callbackUrl },
    });
    live.addRoute('$connect', { integration: new WebSocketLambdaIntegration('Connect', liveFn) });
    live.addRoute('$disconnect', { integration: new WebSocketLambdaIntegration('Disconnect', liveFn) });
    const pong = new CfnIntegration(this, 'PingIntegration', {
      apiId: live.apiId, integrationType: 'MOCK',
      requestTemplates: { $default: '{"statusCode": 200}' }, templateSelectionExpression: '\\$default',
    });
    new CfnIntegrationResponse(this, 'PingIntegrationResponse', {
      apiId: live.apiId, integrationId: pong.ref, integrationResponseKey: '$default',
      responseTemplates: { $default: '{"type":"pong"}' }, templateSelectionExpression: '\\$default',
    });
    const pingRoute = new CfnRoute(this, 'PingRoute', {
      apiId: live.apiId, routeKey: 'ping', target: `integrations/${pong.ref}`, routeResponseSelectionExpression: '$default',
    });
    new CfnRouteResponse(this, 'PingRouteResponse', { apiId: live.apiId, routeId: pingRoute.ref, routeResponseKey: '$default' });

    // HTTP API: the Express app.
    const apiFn = fn('ApiFn', 'api', { functionName: NAMES.apiFunction, environment: { LIVE_CALLBACK_URL: liveStage.callbackUrl } });
    live.grantManageConnections(apiFn);
    const http = new HttpApi(this, 'Http', { apiName: NAMES.httpApi, createDefaultStage: false, defaultIntegration: new HttpLambdaIntegration('Api', apiFn) });
    new HttpStage(this, 'HttpStage', { httpApi: http, stageName: '$default', autoDeploy: true, throttle: GUARDRAILS.httpApi });

    // Nightly reset, which also seeds the table after the first deploy.
    const resetFn = fn('ResetFn', 'reset', { timeout: Duration.minutes(2), environment: { LIVE_CALLBACK_URL: liveStage.callbackUrl } });
    new Schedule(this, 'NightlyReset', {
      schedule: ScheduleExpression.cron({ minute: '0', hour: '3', timeZone: TimeZone.EUROPE_HELSINKI }),
      target: new LambdaInvoke(resetFn),
    });
    for (const f of [apiFn, liveFn, resetFn]) table.grantReadWriteData(f);

    // Web app: private bucket behind CloudFront, which also routes /api/* to the HTTP API and /api/live to the WebSocket API.
    const bucket = new Bucket(this, 'Web', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL, enforceSSL: true, removalPolicy: RemovalPolicy.DESTROY, autoDeleteObjects: true,
    });
    const apiBehavior = {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };
    const viewerRequest = (name: string, code: string) => [{
      eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      function: new cloudfront.Function(this, name, { code: cloudfront.FunctionCode.fromInline(code), runtime: cloudfront.FunctionRuntime.JS_2_0 }),
    }];
    const distribution = new cloudfront.Distribution(this, 'Site', {
      defaultRootObject: 'index.html',
      // Required by the flat-rate plan, which has no per-region charges.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      webAclId: props.webAclArn,
      ...(props.domain && {
        domainNames: [props.domain.name],
        certificate: Certificate.fromCertificateArn(this, 'Certificate', props.domain.certificateArn),
      }),
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        // Client-side routes (no file extension) get the app shell.
        functionAssociations: viewerRequest('SpaRoutes', "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) r.uri = '/index.html'; return r; }"),
      },
      additionalBehaviors: {
        '/api/live': {
          ...apiBehavior,
          origin: new HttpOrigin(`${live.apiId}.execute-api.${this.region}.amazonaws.com`),
          // The WebSocket API serves exactly its stage path.
          functionAssociations: viewerRequest('LivePath', `function handler(event) { event.request.uri = '/${liveStage.stageName}'; return event.request; }`),
        },
        '/api/*': { ...apiBehavior, origin: new HttpOrigin(`${http.apiId}.execute-api.${this.region}.amazonaws.com`) },
      },
    });
    new BucketDeployment(this, 'WebDeployment', {
      sources: [Source.asset(webDist)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      logGroup: new LogGroup(this, 'WebDeploymentLogs', { retention: GUARDRAILS.logRetention, removalPolicy: RemovalPolicy.DESTROY }),
    });

    new CfnOutput(this, 'Url', { value: `https://${props.domain?.name ?? distribution.distributionDomainName}` });
    new CfnOutput(this, 'CloudFrontDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'ResetFunction', { value: resetFn.functionName });
  }
}
