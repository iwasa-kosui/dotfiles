# ADR-002: YAML（正）+ Mermaid（可視化）の二層データモデル

## ステータス

承認

## コンテキスト

RDRA成果物のデータ表現をどうするか。要件は:

- 機械的に処理可能（トレーサビリティチェック、整合性検証）
- 人間が読みやすい（レビュー、チーム共有）
- GitHubでプレビュー可能

## 決定

**YAMLをSingle Source of Truth（SSoT）**とし、**Mermaid図はYAMLから生成されるビュー**として扱う。

## 理由

- **YAMLがSSoT**: 要素ID、属性、関連はYAMLで定義する。構造化されたデータなのでプログラム的なチェック（未参照要素の検出、IDの重複チェック等）が容易
- **Mermaidはビュー**: 同一のYAMLデータから複数の図を生成できる（例: 情報モデルからER図とユースケース関連図）。図を直接編集するのではなく、YAMLを更新して図を再生成する
- **GitHubプレビュー対応**: MermaidはGitHub Markdownでネイティブレンダリングされる。PlantUMLは外部サービスが必要
- **Markdownへの埋め込み**: YAMLフロントマターとMermaidコードブロックを1つのMarkdownファイルに同居させられる。`contexts/{name}.md` は先頭にYAMLメタデータ、本文にMermaid図と説明を持つ

## トレードオフ

- YAMLとMermaid図の同期が課題 → 更新モードでYAML変更時にMermaid図も再生成するフローを定義
- Mermaidの表現力に限界がある（例: RDRA固有の記法は再現不可） → 標準的なMermaid図種で代替する（ADR-004で詳細を定義）
