---
description: サブエージェントでのBash使用制限
alwaysApply: true
---

# サブエージェント（Agent）での Bash 使用制限

サブエージェントを含む全てのコンテキストで、以下のルールを厳守する。

## 原則: 専用ツールを優先し、Bash パイプラインを避ける

ファイルの読み取り・検索・加工には専用ツール（Read, Grep, Glob）を使う。
`cat file | python3 -c "..."` や `cat file | jq` のようなパイプラインは許可プロンプトを発生させるため禁止。

### 具体的な禁止パターンと代替手段

| 禁止 | 代替 |
|---|---|
| `cat file \| python3 -c "..."` | Read でファイルを読み、内容をコンテキスト内で解析する |
| `cat file \| jq '.key'` | Read でファイルを読み、必要な値を抽出する |
| `cat file \| grep pattern` | Grep ツールを使う |
| `find . -name "*.ts"` | Glob ツールを使う |
| `cat file \| sed ...` | Read + Edit ツールを使う |
| `cat file \| wc -l` | Read ツールで読み取り、行数を数える |

### Bash を使ってよいケース

- git, gh, npm, bun 等のCLIツール実行
- ファイルの読み取りを伴わない単純なコマンド（`ls`, `pwd` 等）
- 専用ツールでは不可能な処理（プロセス管理、ネットワーク操作等）

### JSON/構造化データの処理

ファイル内のJSONを解析する場合、Read でファイルを読んでからコンテキスト内で必要な情報を抽出する。`python3 -c` や `jq` にパイプする必要はない。
