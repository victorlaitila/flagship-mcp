import { App, Tags } from 'aws-cdk-lib';
import { FlagshipStack } from '../lib/flagship-stack.js';
import { GitHubDeployStack } from '../lib/github-deploy-stack.js';
import { KillSwitchStack } from '../lib/kill-switch-stack.js';

const app = new App();
// Kept out of the repository: pass with `-c alertEmail=you@example.com`.
const alertEmail = app.node.tryGetContext('alertEmail');
if (typeof alertEmail !== 'string' || !alertEmail.includes('@')) throw new Error('Pass the kill-switch alert email: -c alertEmail=you@example.com');
const reserved = app.node.tryGetContext('reservedConcurrency');
const reservedConcurrency = reserved === undefined || reserved === 'none' ? null : Number(reserved);

// Pinned: these stacks only ever deploy to the dedicated flagship account.
const account = '612468269152';
const region = 'eu-north-1';
const domainName = app.node.tryGetContext('domainName');
const certificateArn = app.node.tryGetContext('certificateArn');
new FlagshipStack(app, 'Flagship', {
  env: { account, region },
  reservedConcurrency,
  webAclArn: app.node.tryGetContext('webAclArn'),
  domain: domainName && certificateArn ? { name: domainName, certificateArn } : undefined,
});
new KillSwitchStack(app, 'FlagshipKillSwitch', { env: { account, region: 'us-east-1' }, appRegion: region, alertEmail, reservedConcurrency });
// Deployed by hand (`cdk deploy FlagshipGitHubDeploy`); CI deploys only the two stacks above.
new GitHubDeployStack(app, 'FlagshipGitHubDeploy', { env: { account, region }, repository: 'victorlaitila/flagship-mcp' });
Tags.of(app).add('project', 'flagship');
