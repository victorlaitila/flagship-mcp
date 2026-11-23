import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FlagshipStack } from '../lib/flagship-stack.js';
import { GitHubDeployStack } from '../lib/github-deploy-stack.js';
import { KillSwitchStack } from '../lib/kill-switch-stack.js';

// These pin the cost and abuse guardrails: loosening one should be a deliberate change to this test.
const webDist = mkdtempSync(join(tmpdir(), 'flagship-web-'));
writeFileSync(join(webDist, 'index.html'), '<!doctype html>');
const env = { account: '111111111111', region: 'eu-north-1' };
const webAclArn = 'arn:aws:wafv2:us-east-1:111111111111:global/webacl/test/id';
const synth = (reservedConcurrency: number | null) => Template.fromStack(new FlagshipStack(new App(), 'Test', { env, reservedConcurrency, webDist, webAclArn }));
const synthKillSwitch = () => Template.fromStack(new KillSwitchStack(new App(), 'TestKill', {
  env: { ...env, region: 'us-east-1' }, appRegion: 'eu-north-1', alertEmail: 'alerts@example.com', reservedConcurrency: null,
}));

describe('Flagship stack guardrails', () => {
  let template: Template;
  beforeAll(() => {
    template = synth(null);
  }, 120_000);

  it('throttles the HTTP and WebSocket APIs', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { StageName: '$default', DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 30 } });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { StageName: 'live', DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 } });
  });

  it('uses free provisioned table capacity, with TTL for live connections', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: Match.absent(),
      ProvisionedThroughput: { ReadCapacityUnits: 25, WriteCapacityUnits: 25 },
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('keeps every log group for a week', { timeout: 120_000 }, () => {
    const groups = [template, synthKillSwitch()].flatMap((t) => Object.values(t.findResources('AWS::Logs::LogGroup')));
    expect(groups).toHaveLength(5); // api, live, reset, web deployment, kill switch
    for (const group of groups) expect(group.Properties.RetentionInDays).toBe(7);
  });

  it('runs every app function on DynamoDB with Production read-only', () => {
    const appFunctions = Object.values(template.findResources('AWS::Lambda::Function'))
      .filter((f) => f.Properties.Environment?.Variables?.STORAGE);
    expect(appFunctions).toHaveLength(3);
    for (const f of appFunctions) expect(f.Properties.Environment.Variables).toMatchObject({ STORAGE: 'dynamodb', PRODUCTION_READ_ONLY: 'true' });
  });

  it('answers pings without a Lambda', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ping' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', { IntegrationType: 'MOCK' });
    template.hasResourceProperties('AWS::ApiGatewayV2::IntegrationResponse', { ResponseTemplates: { $default: '{"type":"pong"}' } });
  });

  it('stops the API and live updates when actual spend passes $1', () => {
    const kill = synthKillSwitch();
    kill.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetLimit: { Amount: 1, Unit: 'USD' }, TimeUnit: 'MONTHLY', BudgetType: 'COST' },
      NotificationsWithSubscribers: [{ Notification: { NotificationType: 'ACTUAL', Threshold: 100 }, Subscribers: [{ SubscriptionType: 'SNS' }] }],
    });
    kill.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'lambda' });
    kill.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'alerts@example.com' });
    const config = JSON.parse(Object.values(kill.findResources('AWS::Lambda::Function'))
      .find((f) => f.Properties.Environment?.Variables?.KILL_SWITCH_CONFIG)!.Properties.Environment.Variables.KILL_SWITCH_CONFIG);
    // The names it stops must be the names the app stack gives its functions and APIs.
    expect(config).toMatchObject({ region: 'eu-north-1', functions: ['flagship-api', 'flagship-live'] });
    kill.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'flagship-kill-switch' }); // infra/scripts/demo.mjs
    template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'flagship-api' });
    template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'flagship-live' });
    for (const stage of config.stages) template.hasResourceProperties('AWS::ApiGatewayV2::Api', { Name: stage.apiName });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { StageName: config.stages[1].stageName });
  }, 120_000);

  it('resets the data nightly at 03:00 Helsinki time', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', { ScheduleExpression: 'cron(0 3 * * ? *)', ScheduleExpressionTimezone: 'Europe/Helsinki' });
  });

  it('never caches the API at CloudFront and has no fixed-cost networking', () => {
    const config = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    expect(config.CacheBehaviors.map((b: { PathPattern: string }) => b.PathPattern)).toEqual(['/api/live', '/api/*']);
    for (const behavior of config.CacheBehaviors) expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // CachingDisabled
    // The WAF web ACL comes with the free flat-rate plan; the stack only keeps it attached.
    expect(config.WebACLId).toBe(webAclArn);
    for (const type of ['AWS::EC2::NatGateway', 'AWS::EC2::VPC', 'AWS::Route53::HostedZone', 'AWS::WAFv2::WebACL']) template.resourceCountIs(type, 0);
  });

  it('reserves concurrency only when the account allows it', () => {
    const reserved = (t: Template) => Object.values(t.findResources('AWS::Lambda::Function'))
      .filter((f) => f.Properties.Environment?.Variables?.STORAGE)
      .map((f) => f.Properties.ReservedConcurrentExecutions);
    expect(reserved(template)).toEqual([undefined, undefined, undefined]);
    expect(reserved(synth(5))).toEqual([5, 5, 5]);
  }, 120_000);

  it('serves a custom domain with its certificate when one is configured', () => {
    const certificateArn = 'arn:aws:acm:us-east-1:111111111111:certificate/test';
    const withDomain = Template.fromStack(new FlagshipStack(new App(), 'TestDomain', {
      env, reservedConcurrency: null, webDist, domain: { name: 'flagship.example.com', certificateArn },
    }));
    const config = Object.values(withDomain.findResources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    expect(config.Aliases).toEqual(['flagship.example.com']);
    expect(config.ViewerCertificate).toMatchObject({ AcmCertificateArn: certificateArn, SslSupportMethod: 'sni-only' });
  }, 120_000);

  it('lets only pushes to main deploy, and only through the CDK roles', () => {
    const github = Template.fromStack(new GitHubDeployStack(new App(), 'TestGitHub', { env, repository: 'owner/repo' }));
    github.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: { Statement: [{
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': 'repo:owner/repo:ref:refs/heads/main' } },
      }] },
    });
    const statements = Object.values(github.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
    expect(statements).toEqual([expect.objectContaining({ Action: ['sts:AssumeRole', 'sts:TagSession'], Resource: 'arn:aws:iam::111111111111:role/cdk-hnb659fds-*' })]);
  });
});
