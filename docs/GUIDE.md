# Guide

How Flagship works and how to use it: from the dashboard, the demo storefront and Claude Code. Start it first (`npm install && npm run dev`, see the [README](../README.md)), and keep two browser windows open side by side:

- **Dashboard:** http://localhost:5173
- **Storefront:** http://localhost:5173/store

Everything below uses the seeded demo data. `npm run db:reset` restores it.

## The idea in one minute

A **feature flag** decides, per user, whether a feature is on, or which variant they get. Flagship stores a separate configuration per **environment** (Development, Staging, Production), and answers "what does this user get?" with a result and a reason.

A flag configuration combines:

- **Enabled:** the master switch for the environment.
- **Targeting rules:** for example "include Finnish customers" or "exclude employees". Exclusions always win.
- **Segments:** reusable groups of users (Premium Customers, Beta Testers…) that rules can refer to.
- **A fallback for everyone else:** a default (on/off flags), a rollout percentage, or variant weights.
- **Prerequisites:** other flags that must be on for the same user first.

Percentage rollouts are deterministic: a user always lands in the same bucket (0–99.99) for a given flag, so raising 25% to 70% only adds users. The exact rules are in the [reference](REFERENCE.md#evaluation).

The **storefront** (a fake Nordic homeware shop, "Nordhem") asks the API how every flag evaluates for the selected customer and environment, and renders accordingly. When a flag changes anywhere, open pages update within a moment, without a reload.

## A quick tour

**Storefront**
- The dark **context bar** at the top chooses the demo customer and the environment the shop evaluates against. "Live flags" (green) means it is receiving live updates.
- The floating **Flags** button opens an inspector: every flag's result for the current customer, with its reason.
- Five demo customers:

| Customer | Country | Account | Notes |
|---|---|---|---|
| Aino | FI | regular | |
| Eero | FI | premium | |
| Sanna | FI | employee | beta tester |
| Jonas | SE | regular | beta tester |
| Emma | US | regular | |

**Dashboard**

| Page | What it's for |
|---|---|
| Feature flags | List, search and filter flags; create new ones. |
| Flag page | Edit the config per environment tab. *Preview* shows which demo customers would change, without saving. The panel on the right shows current results and recent changes. |
| Environments | What differs between Development, Staging and Production. |
| Segments | Reusable user groups and where they are used. |
| Activity | The audit log: who changed what, with before/after, and rollback. |

- The **identity switcher** in the sidebar picks who you are:

| Identity | Can change |
|---|---|
| Leo (Developer) | Development |
| Ida (Release Manager) | Development and Staging |
| Sara (Admin) | Everything |

- Production changes always go through a review dialog.

## Walkthroughs

Each walkthrough says what to do and what you should see. They all start from the seeded data.

### 1. Roll out a feature gradually

`ai_recommendations` shows "Recommended for you" instead of "Popular products" on product and cart pages. In Production it is at **25%**:

- Emma (bucket 1.77) is in.
- Aino (90.19), Eero (68) and Jonas (94.69) are out.
- Sanna is in through the rule "Employees always see recommendations".

1. In the store, select **Eero** in Production and open any product: you see *Popular products*.
2. In the dashboard, as Sara, open `ai_recommendations` → Production. Set the rollout to **70** and click **Preview**: Eero is listed as changing from off to on.
3. Click **Review & apply**. The dialog shows the stored config next to exactly what will be saved. Apply.
4. The store switches to *Recommended for you* on its own. Activity shows the change by Sara Koskinen.

### 2. Flip a kill switch

`new_payment_api` routes payments through "Flagship Pay". In Production it excludes US customers ("Not yet certified for US cards"), and `new_checkout` requires it.

1. As **Emma**, add something to the cart and open checkout: the legacy card form and a fallback notice appear, because Emma is excluded. The inspector shows `new_checkout` on its default variant with the reason *Prerequisite "new_payment_api" is not enabled*.
2. Switch to **Aino**: Flagship Pay is offered.
3. In the dashboard, as Sara, turn **Enabled** off for `new_payment_api` in Production and apply. Every customer's checkout falls back immediately.

### 3. Target by country and segment

`free_shipping_banner` in Production:

- It includes the Nordics through the rule "Nordic customers".
- It excludes employees through the rule "No promos for employees".

Switch between customers in the store:

- Aino, Eero and Jonas see the green free-shipping banner.
- Sanna doesn't, because she is excluded as an employee.
- Emma doesn't, because no rule matches her.

Change the rule in the dashboard, Preview it, and watch the banner follow.

### 4. Chain features with prerequisites

`loyalty_rewards` requires `loyalty_program`, and both are on in Development.

1. As **Leo** (Developer), turn `loyalty_program` off in Development. Rewards disappear in the store too (reason `PREREQUISITE_FAILED`).
2. Try adding `new_checkout` as a prerequisite of `new_payment_api`: the save is refused as a circular dependency, with an explanation.

### 5. Permissions

Switch to **Leo** and open any flag's Staging or Production tab. It is read-only, and Activity's *Roll back* buttons are disabled there. The API enforces the same rule: a direct request gets HTTP 403.

### 6. Audit and rollback

Activity lists every change with its before/after.

1. Expand an entry and click **Roll back**. The dialog compares the configuration *stored now* with exactly what the rollback will store.
2. Rollback restores the *whole* configuration from before that entry. If the flag changed again afterwards, a warning says so, and those later changes appear in the comparison because they will be undone too.
3. Restoring writes a new "Rolled back" entry; history is never rewritten.

### 7. Two people editing the same flag

1. Open the same flag and environment in two dashboard windows.
2. Start an edit in the first window without saving. In the second, save a different change.
3. The first window shows: *changed elsewhere since you started editing*. Save is disabled and your draft stays visible. *Discard my edits and load the latest* shows the other change.

A save can never silently overwrite someone else's change, whether it came from the dashboard, the API or Claude Code.

### 8. What happens if the API goes down

Stop `npm run dev` while the store and dashboard are open:

- The store's indicator changes to *Reconnecting… · last known flags*.
- The dashboard shows a "Live updates interrupted" notice. The pages keep showing the last known data.

Start it again. Both pages reconnect by themselves, reload what they show, and the indicator turns green again. Anything changed in the meantime is picked up. (To stop only the API, run the API and web app in separate terminals with `npm run dev -w @flagship/api` and `npm run dev -w @flagship/web`.)

## Using Flagship from Claude Code (MCP)

The repository includes an MCP server, so you can manage flags by asking Claude in plain language. It uses the same API as the dashboard, so the same validation, permissions, audit log and live updates apply.

**Setup:**
1. Keep `npm run dev` running.
2. Start `claude` in the repository root and approve the `flagship` server when asked (it is defined in `.mcp.json`).
3. `/mcp` shows whether it is connected.

**How changes work.** Claude acts as **Claude Code (Release Manager)**: it can change Development and Staging, and only *read and plan* Production. Every change takes two steps:

1. **Plan:** Claude shows you the change as the backend would save it, which demo customers it affects, and whether it is permitted. Nothing is saved yet.
2. **Apply:** only after you agree. The apply is bound to that exact plan. If the arguments differ, or the flag changed in the meantime, it is refused and Claude has to plan again.

### Things to try

| Ask Claude | What happens | Where you see it |
|---|---|---|
| "Which flags differ between Staging and Production?" | Compares the environments field by field. | Claude's answer; dashboard → Environments |
| "Would Emma get the new checkout in Production? Why not?" | Asks the real evaluation engine. Answer: no, because the `new_payment_api` prerequisite excludes US customers. | Claude's answer; the store's inspector as Emma |
| "Roll AI recommendations out to 100% in Staging." | Plans it (50% → 100%, Aino, Eero, Sanna and Jonas switch on) and asks for your go-ahead. After you agree, it applies the change. | Store as Aino in Staging, on a product page: *Recommended for you* appears. Activity: "Claude Code · Release Manager" |
| "Undo that." | Plans a rollback against the current config (showing anything else it would also undo), then rolls back after you agree. | The store reverts; Activity: "Rolled back … of #n" |
| "Enable the loyalty program for everyone in Production." | Plans it and explains the impact, but Production is read-only for Claude: an Admin must apply it in the dashboard. | Nothing changes |
| "Set a 50% rollout on new_payment_api in Staging." | The plan shows that the backend would drop this: an on/off flag has no rollout. Nothing is offered to apply. | Claude's answer |

If someone edits a flag in the dashboard between Claude's plan and the apply, the apply is refused and the other person's change is kept.

## Where results show up

| You want to know… | Look at |
|---|---|
| What a customer experiences | The storefront, with the customer and environment selected in the context bar |
| Why they get it | The store's **Flags** inspector, the flag page's evaluation panel, or ask Claude |
| What a change *would* do | **Preview** on the flag page, the Production review dialog, or a Claude plan |
| Who changed what, and when | Activity, or a flag page's *Recent changes* |
| How environments differ | Dashboard → Environments |
| Whether live updates work | The store's indicator (green *Live flags*), or the dashboard notice when interrupted |
