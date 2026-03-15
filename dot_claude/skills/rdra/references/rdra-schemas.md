# RDRA成果物 YAMLスキーマ

各Markdownファイルの先頭にYAMLフロントマターとしてRDRA要素の構造化データを記述する。
RDRA 3.0に準拠し、条件・バリエーションはシステムレイヤーに配置する。

## 目次

1. [overview.md](#1-overviewmd)
2. [contexts/{name}.md](#2-contextsnamemd)
3. [shared/information-model.md](#3-sharedinformation-modelmd)
4. [shared/state-models.md](#4-sharedstate-modelsmd)
5. [traceability.yaml](#5-traceabilityyaml)

---

## 1. overview.md

プロジェクト全体の概観。アクター・ゴール・コンテキスト一覧を定義する。

```yaml
---
type: rdra-overview
project: "プロジェクト名"
actors:
  - id: "ACTOR-001"
    name: "アクター名"
    type: human | system
    description: "アクターの説明"
goals:
  - id: "GOAL-001"
    name: "ゴール名"
    description: "システム化の目的"
    actors: ["ACTOR-001"]
contexts:
  - id: "BIZ-001"
    name: "context-name"
    description: "コンテキストの概要"
    primary_actors: ["ACTOR-001"]
    goals: ["GOAL-001"]
---
```

本文に含めるMermaid図:
- システムコンテキスト図（`graph TB`）
- コンテキスト間関係図（`graph LR`）

---

## 2. contexts/{name}.md

1ファイルで4レイヤーを縦貫するバーティカルスライス。RDRA 3.0のコンテキスト概念に対応。

```yaml
---
type: rdra-context
id: "BIZ-001"
name: "context-name"
display_name: "コンテキスト表示名"

# システム価値レイヤー
value:
  goals: ["GOAL-001"]
  requirements:
    - id: "REQ-001"
      description: "要求の記述"
      traces_to: ["GOAL-001"]

# 外部環境レイヤー
environment:
  business_usecases:
    - id: "BUC-001"
      name: "ビジネスユースケース名"
      actors: ["ACTOR-001"]
      description: "BUCの説明"
      traces_to: ["REQ-001"]

# システム境界レイヤー
boundary:
  usecases:
    - id: "UC-001"
      name: "ユースケース名"
      actors: ["ACTOR-001"]
      screens: ["SCR-001"]
      events: ["EVT-001"]
      traces_to: ["BUC-001"]
      description: "UCの説明"
  screens:
    - id: "SCR-001"
      name: "画面名"
      description: "画面の説明"
      information: ["INFO-001"]
  events:
    - id: "EVT-001"
      name: "イベント名"
      trigger: "トリガー条件"
      description: "イベントの説明"

# システムレイヤー（shared/への参照 + 条件・バリエーション）
system:
  information: ["INFO-001", "INFO-002"]
  states: ["STATE-001"]
  conditions:
    - id: "COND-001"
      name: "条件名"
      description: "条件の説明"
      traces_to: ["UC-001"]
  variations:
    - id: "VAR-001"
      name: "バリエーション名"
      values: ["値A", "値B"]
      description: "バリエーションの説明"
      traces_to: ["UC-001"]
---
```

本文に含めるMermaid図:
- ビジネスコンテキスト図（`graph LR`）
- 業務フロー（`sequenceDiagram`）: BUCごと
- ロバストネス図（`flowchart` + `classDef`）: UCごと

---

## 3. shared/information-model.md

コンテキスト横断のエンティティ定義。

```yaml
---
type: rdra-information-model
entities:
  - id: "INFO-001"
    name: "エンティティ名"
    description: "エンティティの説明"
    attributes:
      - name: "属性名"
        type: "型"
        required: true | false
        description: "属性の説明"
    relations:
      - target: "INFO-002"
        type: "1:N" | "N:1" | "1:1" | "N:M"
        label: "関連名"
    traces_to: ["UC-001", "SCR-001"]
---
```

本文にER図（`erDiagram`）を含む。

---

## 4. shared/state-models.md

状態遷移モデル定義。

```yaml
---
type: rdra-state-models
models:
  - id: "STATE-001"
    entity: "INFO-001"
    name: "状態モデル名"
    description: "状態モデルの説明"
    states:
      - name: "状態名"
        description: "状態の説明"
    transitions:
      - from: "状態A"
        to: "状態B"
        trigger: "EVT-001 | UC-001"
        condition: "遷移条件（任意）"
    traces_to: ["UC-001"]
---
```

本文に状態遷移図（`stateDiagram-v2`）を含む。

---

## 5. traceability.yaml

全要素のトレーサビリティマトリックス。`traces_to` のみを保持し、`traced_from` は保持しない。

```yaml
version: "1.0"
generated_at: "2026-03-07T00:00:00Z"

elements:
  - id: "GOAL-001"
    type: goal
    name: "ゴール名"
    defined_in: "rdra/overview.md"
    traces_to: []

  - id: "REQ-001"
    type: requirement
    name: "要求名"
    defined_in: "rdra/contexts/context-name.md"
    traces_to: ["GOAL-001"]

  - id: "BUC-001"
    type: business_usecase
    name: "BUC名"
    defined_in: "rdra/contexts/context-name.md"
    traces_to: ["REQ-001"]

  - id: "UC-001"
    type: usecase
    name: "UC名"
    defined_in: "rdra/contexts/context-name.md"
    traces_to: ["BUC-001"]

  - id: "FR-001"
    type: functional_requirement
    name: "機能要件名"
    defined_in: "specs/prd.md"
    traces_to: ["UC-001"]

  - id: "SPEC-001"
    type: specification
    name: "仕様名"
    defined_in: "specs/spec.md"
    traces_to: ["FR-001"]

  - id: "TASK-001"
    type: task
    name: "タスク名"
    defined_in: "specs/tasks.md"
    traces_to: ["SPEC-001", "UC-001"]

coverage:
  total_goals: 1
  goals_with_requirements: 1
  total_requirements: 1
  requirements_with_bucs: 1
  total_bucs: 1
  bucs_with_ucs: 1
  total_ucs: 1
  ucs_with_specs: 1
  total_specs: 1
  specs_with_tasks: 1
  orphaned_elements: []
```

### カバレッジ指標

| メトリクス | 計算方法 | 期待値 |
|-----------|---------|--------|
| ゴールカバレッジ | REQが紐づいたGOALの割合 | 100% |
| 要求カバレッジ | BUCが紐づいたREQの割合 | 100% |
| BUCカバレッジ | UCが紐づいたBUCの割合 | 100% |
| Specカバレッジ | TASKが紐づいたSpecの割合 | 100% |
| 孤立要素 | GOALに到達しない要素の一覧 | 0件 |

### 下流方向の走査（影響分析）

`traces_to` の逆引きで動的に算出する。更新モードのStep 1で使用:

1. 変更対象要素をキーに、全要素の `traces_to` を走査して逆引きインデックスを構築
2. 逆引きインデックスを再帰的に辿り、影響を受ける下流要素を特定
3. 影響ツリーをMermaid `graph TD` で可視化
