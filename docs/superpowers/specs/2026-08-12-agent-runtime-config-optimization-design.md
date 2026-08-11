# コーディングエージェント設定最適化 設計

## 背景

Codex、Claude Code、Cursor の設定は、同じ安全・運用ポリシーをそれぞれの
rules、skills、hooks に重複して持つ。調査では Codex の未配備ルール参照、
Claude 固有語の混入、未配備 skill の必須化、runtime 間で異なる ship 権限、
hook の禁止対象と文書規約の不一致を確認した。

## 決定

### 共通の状態遷移

実装または設定変更を依頼され、必要な検証に成功した場合、すべての
runtime は作業ブランチで次を自動実行できる。

1. Conventional Commits の scope 付きコミットを作る。
2. そのブランチを origin に push する。
3. Draft PR を作成または更新する。

調査、質問、設計相談、コードレビューだけのタスクは ship しない。Ready 化、
merge、force push、保護ブランチへの直接変更は明示依頼が必要とする。

### ポリシーの正本

`agent_policy/` をリポジトリ上の正本とし、次の内容を置く。

- `contract.md`: 共通安全境界、ship 状態遷移、runtime 固有に残す責務。
- `runtime-manifest.json`: 各 runtime の配備先、rules、skills、hooks、
  subagent の扱いを機械検証する台帳。

各 runtime の設定は adapter として残す。hook のイベント名・JSON 形式・
permission 形式・実行モデルの選択は adapter 固有であり、共通化しない。

### Codex の正規化

`dot_codex/AGENTS.md` は `~/.codex` 配下の実在ファイルだけを参照する。
Claude Code の `Agent`、`allowed-tools`、`CLAUDE_CODE_SUBAGENT_MODEL`、
Opus/Sonnet 固有の指示、存在しない `RTK.md` への依存は除去する。

Codex に必要なルールは `dot_codex/rules/` として chezmoi 管理下に置く。
共通ルールの本文は Claude/Cursor の adapter と意味が同じであることを
contract test で守る。runtime 固有の frontmatter、hook matcher、表示文は
その test の対象外とする。

### Skill と hook

skill は実行 runtime のホームディレクトリ・表示名・Co-Authored-By を
固定しない。存在を確認できない review/外部サービス skill は
「存在時にのみ使う」依存にする。

hook は登録済みエントリだけを動作対象とする。未登録の Claude 専用 hook は
削除するか、runtime-manifest で保留理由と所有者を明記する。`~/.claude` を
状態保存先にする Codex/Cursor の実装は、当該 runtime の状態保存先へ直す。

## 非目標

- 各製品の permission モデル、hook プロトコル、UI、status line を同一化しない。
- Ready PR、merge、force push を自動化しない。
- 秘密情報の実値を検証・出力しない。
- 未確認の Codex hook matcher を推測して追加しない。既存 matcher の有効性は
  非破壊の配備後検証として記録する。

## 受入条件

1. `agent_policy/runtime-manifest.json` が3 runtime の責務と配備物を列挙する。
2. Codex が未配備パス、Claude 固有の実行 API、存在しない RTK へ依存しない。
3. 共通の秘密情報、保護ブランチ、worktree、Draft ship 方針が3 runtime で
   一致する。
4. skill が runtime をまたぐ `.claude` パスや固定の実行者名へ依存しない。
5. `bun test tests/agent-config-contract.test.ts` と既存 hook 回帰テストが通る。
6. `chezmoi diff` で変更対象がこの設計の配備物に限定される。

## 検証方針

設定変更は、まず contract test を失敗させてから設定を直す。テストは
秘密情報を読まず、ファイルの存在、JSON 構造、禁止された cross-runtime 参照、
必要なポリシー文言を検証する。最後に既存の branch guard と関連する skill test
を実行し、chezmoi の dry-run で配備差分を確認する。
