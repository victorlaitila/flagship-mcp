import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { OidcProviderNative, PolicyStatement, Role, WebIdentityPrincipal } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GitHubDeployStackProps extends StackProps {
  /**
   * The repository's OIDC subject prefix, in GitHub's immutable form `repo:<owner>@<owner id>/<name>@<repo id>`
   * (`gh api repos/<owner>/<name>/actions/oidc/customization/sub`); the ids keep a renamed or re-created repo out.
   */
  subjectPrefix: string;
}

/**
 * Lets GitHub Actions deploy without stored AWS keys: GitHub's OIDC token is exchanged for a role that only the
 * repository's `main` branch can assume, and that can only use the CDK bootstrap roles. Deployed by hand, never by CI.
 */
export class GitHubDeployStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubDeployStackProps) {
    super(scope, id, props);
    const provider = new OidcProviderNative(this, 'GitHub', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const role = new Role(this, 'DeployRole', {
      roleName: 'flagship-github-deploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // Pushes to main only: not pull requests, other branches, tags or forks.
          'token.actions.githubusercontent.com:sub': `${props.subjectPrefix}:ref:refs/heads/main`,
        },
      }),
    });
    // Everything else goes through the CDK bootstrap roles (deploy, publish assets, lookups), in any region.
    role.addToPolicy(new PolicyStatement({
      actions: ['sts:AssumeRole', 'sts:TagSession'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
    }));
    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
