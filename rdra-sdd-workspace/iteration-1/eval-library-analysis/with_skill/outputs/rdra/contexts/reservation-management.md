---
type: rdra-context
id: "BIZ-003"
name: "reservation-management"
display_name: "予約管理"

# システム価値レイヤー
value:
  goals: ["GOAL-003"]
  requirements:
    - id: "REQ-009"
      description: "貸出中の図書に対して予約を登録できること"
      traces_to: ["GOAL-003"]
    - id: "REQ-010"
      description: "予約した図書が返却された際に通知を受けられること"
      traces_to: ["GOAL-003"]
    - id: "REQ-011"
      description: "不要になった予約を取り消せること"
      traces_to: ["GOAL-003"]
    - id: "REQ-012"
      description: "予約の順番を公平に管理できること（先着順）"
      traces_to: ["GOAL-003"]

# 外部環境レイヤー
environment:
  business_usecases:
    - id: "BUC-009"
      name: "図書を予約する"
      actors: ["ACTOR-001"]
      description: "一般会員が貸出中の図書に対して予約を登録する"
      traces_to: ["REQ-009"]
    - id: "BUC-010"
      name: "予約を取り消す"
      actors: ["ACTOR-001"]
      description: "一般会員が不要になった予約を取り消す"
      traces_to: ["REQ-011"]
    - id: "BUC-011"
      name: "予約可能通知を受け取る"
      actors: ["ACTOR-001"]
      description: "予約していた図書が返却された際に、予約順位1位の会員に通知する"
      traces_to: ["REQ-010"]
    - id: "BUC-012"
      name: "予約状況を管理する"
      actors: ["ACTOR-002"]
      description: "司書が全体の予約状況を確認し、予約期限切れの処理を行う"
      traces_to: ["REQ-012"]

# システム境界レイヤー
boundary:
  usecases:
    - id: "UC-011"
      name: "予約を登録する"
      actors: ["ACTOR-001"]
      screens: ["SCR-004", "SCR-009"]
      events: []
      traces_to: ["BUC-009"]
      description: "一般会員が蔵書詳細画面から予約を登録する"
    - id: "UC-012"
      name: "予約を取り消す"
      actors: ["ACTOR-001"]
      screens: ["SCR-009"]
      events: []
      traces_to: ["BUC-010"]
      description: "一般会員がマイページの予約一覧から予約を取り消す"
    - id: "UC-013"
      name: "予約可能通知を送信する"
      actors: []
      screens: []
      events: ["EVT-002", "EVT-004"]
      traces_to: ["BUC-011"]
      description: "図書返却時に予約順位1位の会員へ取置き通知メールを送信する"
    - id: "UC-014"
      name: "予約状況を一覧表示する"
      actors: ["ACTOR-002"]
      screens: ["SCR-010"]
      events: []
      traces_to: ["BUC-012"]
      description: "司書が全体の予約一覧を確認する"
    - id: "UC-015"
      name: "予約期限切れを処理する"
      actors: []
      screens: []
      events: ["EVT-005"]
      traces_to: ["BUC-012"]
      description: "取置き期限を過ぎた予約を自動キャンセルし、次の予約者へ通知する"
  screens:
    - id: "SCR-009"
      name: "マイページ（予約状況）"
      description: "一般会員が自身の予約一覧を確認し、予約取消操作を行う画面"
      information: ["INFO-004", "INFO-001"]
    - id: "SCR-010"
      name: "予約管理一覧画面"
      description: "司書が全予約状況を確認・管理する画面"
      information: ["INFO-004", "INFO-001", "INFO-003"]
  events:
    - id: "EVT-004"
      name: "取置き通知送信"
      trigger: "返却処理完了時に予約順位1位の予約が存在する場合"
      description: "予約順位1位の会員へ取置き通知メールを送信する"
    - id: "EVT-005"
      name: "予約期限チェックバッチ"
      trigger: "日次バッチ処理（毎日AM9:00）"
      description: "取置き期限（3日間）を超過した予約を自動キャンセルし、次の予約者へ通知する"

# システムレイヤー
system:
  information: ["INFO-001", "INFO-003", "INFO-004"]
  states: ["STATE-001", "STATE-003"]
  conditions:
    - id: "COND-005"
      name: "予約可能条件"
      description: "対象蔵書が貸出中であり、同一会員による重複予約がなく、予約上限数に達していないこと"
      traces_to: ["UC-011"]
    - id: "COND-006"
      name: "予約取消可能条件"
      description: "対象予約が「予約待ち」または「取置き中」の状態であること"
      traces_to: ["UC-012"]
  variations:
    - id: "VAR-003"
      name: "取置き期間"
      values: ["3日間"]
      description: "予約図書の返却後、予約者が取りに来るまでの取置き期限"
      traces_to: ["UC-015"]
---

# 予約管理コンテキスト

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 一般会員"]
    actor2["ACTOR-002: 司書"]

    subgraph biz3["BIZ-003: 予約管理"]
        buc9["BUC-009: 図書を予約する"]
        buc10["BUC-010: 予約を取り消す"]
        buc11["BUC-011: 予約可能通知を受け取る"]
        buc12["BUC-012: 予約状況を管理する"]
    end

    actor1 --> buc9
    actor1 --> buc10
    actor1 --> buc11
    actor2 --> buc12
```

## 業務フロー

### BUC-009: 図書を予約する

```mermaid
sequenceDiagram
    actor Member as 一般会員
    participant S as 図書館管理システム

    Member->>S: 蔵書詳細画面で予約ボタンを押下
    activate S
    S->>S: 予約可能条件を確認
    alt 予約可能
        S-->>Member: 予約完了（予約順位を表示）
    else 予約不可
        S-->>Member: 予約不可の理由を表示
    end
    deactivate S
```

### BUC-011: 予約可能通知を受け取る

```mermaid
sequenceDiagram
    actor Librarian as 司書
    participant S as 図書館管理システム
    actor Member as 一般会員（予約者）

    Librarian->>S: 返却処理を実行
    activate S
    S->>S: 予約有無を確認
    alt 予約あり
        S->>Member: 取置き通知メール送信
        S->>S: 蔵書を「取置き中」に変更
        S-->>Librarian: 返却完了（予約者通知済み）
    else 予約なし
        S->>S: 蔵書を「利用可能」に変更
        S-->>Librarian: 返却完了
    end
    deactivate S
```

### BUC-012: 予約期限切れ処理

```mermaid
sequenceDiagram
    participant Batch as 日次バッチ
    participant S as 図書館管理システム
    actor Member as 次の予約者

    Batch->>S: 予約期限チェック実行
    activate S
    S->>S: 取置き期限超過の予約を検出
    alt 次の予約者あり
        S->>S: 現予約をキャンセル
        S->>Member: 取置き通知メール送信
    else 次の予約者なし
        S->>S: 現予約をキャンセル
        S->>S: 蔵書を「利用可能」に変更
    end
    deactivate S
```

## ロバストネス図

### UC-011: 予約を登録する

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    actor["ACTOR-001: 一般会員"]

    subgraph boundarySg["バウンダリ"]
        scr4["SCR-004: 蔵書詳細画面"]:::boundary
        btn1["予約ボタン"]:::boundary
    end

    subgraph controlSg["コントローラ"]
        ctrl1["UC-011: 予約を登録する"]:::control
    end

    subgraph entitySg["エンティティ"]
        info1[("INFO-001: 蔵書")]:::entity
        info4[("INFO-004: 予約")]:::entity
        info3[("INFO-003: 会員")]:::entity
    end

    actor --> btn1
    btn1 --> ctrl1
    ctrl1 --> info1
    ctrl1 --> info4
    ctrl1 --> info3
    scr4 -.- ctrl1
```

### UC-013: 予約可能通知を送信する

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    subgraph controlSg["コントローラ"]
        ctrl1["UC-013: 予約可能通知を送信する"]:::control
    end

    subgraph entitySg["エンティティ"]
        info4[("INFO-004: 予約")]:::entity
        info3[("INFO-003: 会員")]:::entity
    end

    subgraph externalSg["外部"]
        mail["メール送信"]:::boundary
    end

    ctrl1 --> info4
    ctrl1 --> info3
    ctrl1 --> mail
```
