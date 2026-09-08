# SAFE DESTRUCTIVE-OPERATION APPROVAL POLICY

Treat the following operations as **destructive**:

- deleting orders
- deleting order history
- deleting payment records
- deleting customers
- deleting products
- dropping database tables
- truncating tables
- resetting production database
- deleting production database
- modifying migrations that destroy existing data
- deleting Git history
- force-pushing to protected branches
- deleting production environment variables
- changing production payment configuration
- disabling authentication/security controls
- bulk deletion/update affecting existing orders
- running `npm run reset:orders` against production
- any SQL `DROP`, `TRUNCATE`, or broad `DELETE` against production

---

## APPROVAL LEVELS

### LEVEL 0 — SAFE
No confirmation required for:
- reading files
- inspecting database schema
- running tests
- checking logs
- GET requests
- local development
- creating new files
- editing UI
- adding non-destructive code
- running tests against isolated test data

### LEVEL 1 — REVERSIBLE
The agent may perform automatically if the operation is clearly reversible:
- modifying local development data
- creating temporary test records
- restarting the local server
- clearing browser/localStorage cart
- changing development configuration

*Never apply these automatically to production.*

### LEVEL 2 — DESTRUCTIVE LOCAL/TEST OPERATION
Before executing against a local or test environment:
- database reset
- bulk deletion
- dropping test tables
- deleting test users
- resetting test payments

The agent must clearly state:
1. **WHAT** will be deleted
2. **WHERE** it will be deleted
3. **WHY** it is necessary

Then request confirmation if the operation cannot be safely rolled back.

### LEVEL 3 — PRODUCTION DESTRUCTIVE OPERATION
For ANY destructive production operation, **STOP and request explicit confirmation immediately before execution.**

The confirmation must identify:
1. Exact environment: `PRODUCTION`
2. Exact operation (e.g. `DELETE all records from orders, order_items and payment_logs`)
3. Exact affected resources/tables
4. Whether the operation is reversible
5. Whether a backup exists
6. Expected impact

#### Example Confirmation Format:
> ⚠️ **PRODUCTION DESTRUCTIVE OPERATION**
>
> I am about to permanently delete:
> - orders
> - order_items
> - payment_logs
> - webhook_logs
>
> **Database:** PRODUCTION  
> **Reversible:** NO (cannot be undone without backup)  
> **Backup verified:** YES/NO  
>
> **Proceed?** (Requires: *"I approve this production destructive operation."*)

Do NOT execute until explicitly confirmed with the required phrase.

---

## CRITICAL OPERATIONAL RULES

1. **Explicit Language Mandate**: Words such as "reset", "clean", "start fresh", "wipe", "purge", "remove old data", or "delete demo orders" must **NOT** automatically authorize destructive production actions. "Start fresh" means: **prepare the operation and ask for confirmation before executing it.**
2. **Production Database Safety**:
   - Identify the actual production database.
   - Verify the target environment.
   - Verify exact tables/records affected.
   - Create or verify a backup where possible.
   - Show estimated number of affected records.
   - Ask for explicit confirmation before execution.
3. **No Cascade Surprises**: Inspect foreign-key relationships and cascading behavior before executing any delete. Never accidentally delete historical order items, payment records, audit logs, or customer records through cascading deletes.
4. **Prefer Non-Destructive Operations**:
   - Prefer `active = false` over deleting a product.
   - Prefer `available = false` over deleting a product.
   - Prefer `CANCELLED` status over deleting an order.
   - Prefer archival/status changes over permanent deletion. Restaurant financial/order history should normally be preserved.
5. **Order History Retention**: Once genuine customer orders exist, **NEVER delete them simply to clean the dashboard.** Use status filters, date ranges, archival, and reporting filters instead. `reset:orders` should only be used before genuine production transactions exist or after explicit production approval.
6. **Git Safety**: Never force push, delete remote branches, or rewrite shared history. If secrets were committed, recommend credential rotation first, then clean history only after confirming repository strategy.
7. **Payment Safety**: Never delete payment records merely because an order was cancelled. Never modify a successful payment into a fake state. Never manually mark an online payment as PAID unless there is a legitimate verification path. Never delete webhook/payment audit records as part of routine cleanup.
8. **Deployment Safety**: Inspect migrations for destructive statements (`DROP`, `ALTER DROP COLUMN`) and request approval if production data could be lost.
9. **Required Approval Phrase**: For high-risk production operations, require the unambiguous confirmation: **"I approve this production destructive operation."**
10. **Absolute Rule**: When uncertain whether an operation is destructive: **STOP &rarr; explain the risk &rarr; request confirmation.**
11. **Real-Time Local Sync Before Changes**: Before starting any task or making modifications requested by the user, always sync locally with real-time state first (`git fetch`, `git status`, `git pull` if needed, verify environment and live state). Never proceed with changes on stale assumptions.
