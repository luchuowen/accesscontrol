---
name: verify
description: Prove the open change is done — full factory check, fresh-context review, domain review for critical.
disable-model-invocation: true
---
1. `bash scripts/factory-check.sh full`. Red → fix, rerun. Paste the summary lines into the artifact **Verification**.
2. Run each acceptance check from the artifact Spec; record command + result.
3. Spawn `reviewer` with the artifact path and `git diff main...HEAD`. Critical → also `access-review`.
4. Fix every finding that could cause incorrect behaviour; record findings + fixes in the artifact.
