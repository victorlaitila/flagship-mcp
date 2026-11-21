import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { KillSwitchConfig } from '../lambda/kill-switch.js';
import { GUARDRAILS, NAMES } from './flagship-stack.js';

export interface KillSwitchStackProps extends StackProps {
  /** Region of the Flagship stack it stops. */
  appRegion: string;
  /** Receives the budget notice. */
  alertEmail: string;
  reservedConcurrency: number | null;
}

/**
 * At the monthly budget, AWS Budgets notifies SNS and a Lambda stops all API and live-update traffic of the
 * Flagship stack. In us-east-1, the only region where CloudFormation can create budgets.
 */
export class KillSwitchStack extends Stack {
  constructor(scope: Construct, id: string, props: KillSwitchStackProps) {
    super(scope, id, props);
    const alarms = new Topic(this, 'BudgetAlarm');
    alarms.addToResourcePolicy(new PolicyStatement({
      actions: ['sns:Publish'], principals: [new ServicePrincipal('budgets.amazonaws.com')], resources: [alarms.topicArn],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));
    alarms.addSubscription(new EmailSubscription(props.alertEmail));

    const config: KillSwitchConfig = {
      region: props.appRegion,
      functions: [NAMES.apiFunction, NAMES.liveFunction],
      reservedConcurrency: props.reservedConcurrency,
      stages: [
        { apiName: NAMES.httpApi, stageName: '$default', ...GUARDRAILS.httpApi },
        { apiName: NAMES.liveApi, stageName: NAMES.liveStage, ...GUARDRAILS.webSocket },
      ],
    };
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const killSwitch = new NodejsFunction(this, 'KillSwitchFn', {
      entry: fileURLToPath(new URL('../lambda/kill-switch.ts', import.meta.url)),
      projectRoot: root,
      depsLockFilePath: `${root}package-lock.json`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      bundling: { format: OutputFormat.ESM, minify: true },
      environment: { KILL_SWITCH_CONFIG: JSON.stringify(config) },
      logGroup: new LogGroup(this, 'KillSwitchLogs', { retention: GUARDRAILS.logRetention, removalPolicy: RemovalPolicy.DESTROY }),
    });
    killSwitch.addEventSource(new SnsEventSource(alarms));
    const fnArn = (name: string) => `arn:aws:lambda:${props.appRegion}:${this.account}:function:${name}`;
    killSwitch.addToRolePolicy(new PolicyStatement({
      actions: ['lambda:PutFunctionConcurrency', 'lambda:DeleteFunctionConcurrency'],
      resources: config.functions.map(fnArn),
    }));
    killSwitch.addToRolePolicy(new PolicyStatement({
      actions: ['apigateway:GET'], resources: [`arn:aws:apigateway:${props.appRegion}::/apis`],
    }));
    killSwitch.addToRolePolicy(new PolicyStatement({
      actions: ['apigateway:PATCH'], resources: [`arn:aws:apigateway:${props.appRegion}::/apis/*/stages/*`],
    }));

    new CfnBudget(this, 'Budget', {
      budget: {
        budgetName: 'flagship-kill-switch',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: GUARDRAILS.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [{
        notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' },
        subscribers: [{ subscriptionType: 'SNS', address: alarms.topicArn }],
      }],
    });
    new CfnOutput(this, 'KillSwitchFunction', { value: killSwitch.functionName });
  }
}
