# Architecture

Three diagrams of how Flagship fits together. The reasons are in [Design decisions](DECISIONS.md), the exact limits and settings in the [Reference](REFERENCE.md#deployment-aws).

## The AWS deployment

The public demo ([decision 17](DECISIONS.md#17-a-public-serverless-demo-on-aws-capped-by-throttles-and-a-budget-kill-switch)). Locally, one Express process serves the same API on SQLite, and Vite serves the web app.

```mermaid
flowchart LR
  user([Browser]) -- "flagship.victorlaitila.com" --> waf

  subgraph cdn ["CloudFront, free flat-rate plan"]
    waf[WAF: per-IP rate limit,<br/>bad-input rules] --> cf[Distribution]
  end

  subgraph app ["Flagship stack (eu-north-1)"]
    s3[(S3: web app)]
    http[HTTP API<br/>10/s, burst 30]
    ws[WebSocket API<br/>5/s, burst 10]
    apiFn[Lambda api:<br/>the Express app]
    liveFn[Lambda live:<br/>connect, disconnect]
    resetFn[Lambda reset]
    sched[Scheduler:<br/>03:00 Helsinki] --> resetFn
    db[(DynamoDB<br/>25 read / 25 write units)]
    http --> apiFn
    ws -- "$connect, $disconnect" --> liveFn
    apiFn & liveFn & resetFn --> db
    apiFn -. change events .-> ws
  end

  cf -- "other paths" --> s3
  cf -- "/api/*" --> http
  cf -- "/api/live" --> ws

  subgraph kill ["FlagshipKillSwitch stack (us-east-1)"]
    budget[Budget: $1 a month] --> sns[SNS] --> killFn[Lambda kill switch]
    sns --> email[Email alert]
  end
  killFn -. "concurrency 0, throttles 0" .-> app

  gh[GitHub Actions:<br/>push to main, tests pass] -. OIDC deploy role .-> app & kill
```

- **Pings** (`{"type":"ping"}`) are answered by the WebSocket API itself, so they cost no Lambda time.
- **The kill switch** stops the API and live updates; the web page stays up. `npm run demo:stop` and `demo:restore` run it by hand.

## A config change, end to end

A save in the dashboard reaching an open storefront. Locally the steps are the same, with the Express process in place of API Gateway and Lambda.

```mermaid
sequenceDiagram
  participant D as Dashboard
  participant S as Storefront
  participant API as HTTP API + Lambda api
  participant DB as DynamoDB
  participant WS as WebSocket API

  S->>WS: connect to /api/live (Lambda live stores the connection)
  D->>API: PUT /api/flags/:key/environments/:env
  API->>DB: read revision and state, run the checks
  API->>DB: commit config + audit entry
  API->>WS: change event to every connection
  WS-->>S: {"type":"change", ...}
  API-->>D: 200, saved config
  S->>API: refetch what it shows
  API->>DB: read
  API-->>S: new flag results
```

Change events carry no data: clients refetch through the normal endpoints ([decision 15](DECISIONS.md#15-live-updates-over-websocket-with-client-side-pings)). Every request goes through CloudFront, left out above.

## The write path

Every config write, including rollbacks, goes through `applyConfig` (`apps/api/src/services/flags.ts`). Other writes (flags, segments) follow the same order in their services.

```mermaid
flowchart TD
  start([PUT config]) --> rev[Read the store revision]
  rev --> perm{Role may edit<br/>this environment?}
  perm -- no --> e403[403]
  perm -- yes --> ro{Production and<br/>read-only?}
  ro -- yes --> e403
  ro -- no --> conf{Production change<br/>confirmed?}
  conf -- no --> e428[428]
  conf -- yes --> valid{Valid against<br/>current state?}
  valid -- no --> e422[422 with issues]
  valid -- yes --> stale{Matches the client's<br/>expectedConfig?}
  stale -- no --> e409[409, with the current config]
  stale -- yes --> same{Any change?}
  same -- no --> done([200, nothing saved])
  same -- yes --> commit{Commit config + audit entry:<br/>revision unchanged?}
  commit -- no --> e409b[409: changed meanwhile]
  commit -- yes --> publish[Publish change event]
  publish --> ok([200, saved])
```

- **Two conflict checks:** `expectedConfig` catches a change since the user *reviewed* the config ([decision 7](DECISIONS.md#7-optimistic-concurrency-for-every-write)); the revision catches one made *during this request* ([decision 16](DECISIONS.md#16-dynamodb-store-one-table-a-global-revision-guard-and-a-cached-state)).
- **The config and its audit entry** are saved in one atomic commit; a failed change event never fails the request.
