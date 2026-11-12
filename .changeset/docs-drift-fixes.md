---
---

本次仅修正 `docs/` 下的文档漂移，不涉及可发布代码变更，因此为空 changeset。

CI 的 `Validate changeset coverage` 步骤会先改写仓库内被跟踪的 `.npmrc`（切换为官方源），`scripts/validate-changeset.mjs` 会把该工作区改动计入用户可见变更，导致纯文档 PR 也要求 changeset；这里用空 changeset 满足校验，不提升任何包版本。
