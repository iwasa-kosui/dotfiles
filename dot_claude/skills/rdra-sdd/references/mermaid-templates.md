# Mermaid図テンプレート

YAMLがSSoT。Mermaid図はYAMLから生成されるビューとして扱う。YAML更新時はMermaid図も必ず再生成する。

## 1. システムコンテキスト図

アクター・外部システム・対象システムの関係を表現する。overview.mdで使用。

```mermaid
graph TB
    actor1["アクター名"]
    ext1["外部システム名"]
    system["対象システム名"]

    actor1 --> system
    ext1 <--> system
```

## 2. ビジネスコンテキスト図

業務と関係者の横並び関係。contexts/{name}.mdで使用。

```mermaid
graph LR
    actor1["アクター名"]

    subgraph biz1["ビジネスコンテキスト名"]
        buc1["BUC-001: BUC名"]
        buc2["BUC-002: BUC名"]
    end

    actor1 --> buc1
    actor1 --> buc2
```

## 3. 業務フロー（シーケンス図）

BUCごとのアクター間やりとりを時系列で表現。

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant S as システム
    participant Ext as 外部システム

    User->>S: 操作を行う
    activate S
    S->>Ext: 外部連携
    Ext-->>S: 結果を返す
    S-->>User: 結果を表示
    deactivate S

    alt 条件分岐
        S->>User: パターンA
    else
        S->>User: パターンB
    end
```

分岐が多い場合は `alt` / `opt` を使い、さらに複雑な場合はフローチャートに切り替える。

## 4. ロバストネス図（UC複合図の代替）

UCごとのboundary/control/entity関係を `classDef` の色分けで表現。

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    actor["アクター名"]

    subgraph boundarySg["バウンダリ"]
        scr1["SCR-001: 画面名"]:::boundary
        btn1["ボタン名"]:::boundary
    end

    subgraph controlSg["コントローラ"]
        ctrl1["UC-001: ユースケース名"]:::control
    end

    subgraph entitySg["エンティティ"]
        info1[("INFO-001: エンティティ名")]:::entity
    end

    actor --> btn1
    btn1 --> ctrl1
    ctrl1 --> info1
    scr1 -.- ctrl1
```

## 5. ビジネスユースケース図

BUC間の依存関係。

```mermaid
graph TB
    buc1["BUC-001: ビジネスユースケース名"]
    buc2["BUC-002: ビジネスユースケース名"]
    buc3["BUC-003: ビジネスユースケース名"]

    buc1 --> buc2
    buc1 --> buc3
```

## 6. ER図（情報モデル）

shared/information-model.mdで使用。

```mermaid
erDiagram
    ENTITY_A ||--o{ ENTITY_B : "has"
    ENTITY_A {
        string id PK
        string name
        datetime created_at
    }
    ENTITY_B {
        string id PK
        string entity_a_id FK
        string value
    }
```

## 7. 状態遷移図

shared/state-models.mdで使用。遷移のトリガーにEVT-*/UC-* IDを記載する。

```mermaid
stateDiagram-v2
    [*] --> 初期状態
    初期状態 --> アクティブ : 有効化 [EVT-001]
    アクティブ --> 停止 : 停止操作 [UC-002]
    アクティブ --> 完了 : 処理完了 [EVT-002]
    停止 --> アクティブ : 再開操作 [UC-003]
    完了 --> [*]
```
