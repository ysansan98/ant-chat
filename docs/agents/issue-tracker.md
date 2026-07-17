# Issue tracker: GitHub

本仓库的 Issue 和 PRD 均以 GitHub Issues 管理。所有操作使用 `gh` CLI。

## 约定

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行 body 使用 heredoc。
- **读取 Issue**：`gh issue view <number> --comments`，通过 `jq` 过滤评论并获取标签。
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` 和 `--state` 过滤。
- **评论 Issue**：`gh issue comment <number> --body "..."`
- **添加/移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <number> --comment "..."`

仓库信息从 `git remote -v` 自动推断——`gh` 在仓库克隆目录内会自动识别。

## Pull requests as a triage surface

**PR 作为 triage 入口：否。** 外部 PR 不纳入 triage 流程。

## 技能中的「发布到 issue tracker」

创建一条 GitHub Issue。

## 技能中的「获取相关 ticket」

执行 `gh issue view <number> --comments`。

## Wayfinding 操作

由 `/wayfinder` 使用。**地图**是一条带 `wayfinder:map` 标签的 Issue，**子 ticket** 是子 Issue。

- **地图**：一条带 `wayfinder:map` 标签的 Issue，包含 Notes / Decisions-so-far / Fog body。`gh issue create --label wayfinder:map`。
- **子 ticket**：通过 GitHub sub-issues 端点关联地图的 Issue。若 sub-issues 未启用，在地图 body 的任务列表中添加子项，并在子项 body 顶部加 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后分配给开发人员。
- **阻塞关系**：使用 GitHub 原生 Issue 依赖关系。添加阻塞边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞项的**数字数据库 ID**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#number` 或 `node_id`）。若依赖关系不可用，回退到在子项 body 顶部加 `Blocked by: #<n>, #<n>`。所有阻塞项关闭后 ticket 解除阻塞。
- **前沿查询**：列出地图的开放子项，过滤掉有阻塞或已分配的项，按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`
- **解决**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，最后将上下文指针追加到地图的 Decisions-so-far 中。
