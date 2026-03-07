---
type: rdra-context
id: "BIZ-002"
name: "lending-management"
display_name: "貸出管理"

# システム価値レイヤー
value:
  goals: ["GOAL-002"]
  requirements:
    - id: "REQ-005"
      description: "一般会員が蔵書を借りる手続きをシステム上で完結できること"
      traces_to: ["GOAL-002"]
    - id: "REQ-006"
      description: "貸出期限を管理し、延滞状況を把握できること"
      traces_to: ["GOAL-002"]
    - id: "REQ-007"
      description: "返却手続きをシステム上で記録し、貸出状況をリアルタイムに更新できること"
      traces_to: ["GOAL-002"]
    - id: "REQ-008"
      description: "貸出期間の延長を条件付きで許可できること"
      traces_to: ["GOAL-002"]

# 外部環境レイヤー
environment:
  business_usecases:
    - id: "BUC-005"
      name: "図書を貸し出す"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "一般会員が図書の貸出を申請し、司書が貸出処理を行う"
      traces_to: ["REQ-005"]
    - id: "BUC-006"
      name: "図書を返却する"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "一般会員が図書を返却し、司書が返却処理を行う"
      traces_to: ["REQ-007"]
    - id: "BUC-007"
      name: "貸出期間を延長する"
      actors: ["ACTOR-001"]
      description: "一般会員が貸出中の図書の貸出期間延長を申請する"
      traces_to: ["REQ-008"]
    - id: "BUC-008"
      name: "貸出状況を確認する"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "自身の貸出状況（一般会員）または全体の貸出状況（司書）を確認する"
      traces_to: ["REQ-006"]

# システム境界レイヤー
boundary:
  usecases:
    - id: "UC-006"
      name: "貸出を実行する"
      actors: ["ACTOR-002"]
      screens: ["SCR-005"]
      events: []
      traces_to: ["BUC-005"]
      description: "司書が会員IDと蔵書IDを入力し、貸出処理を実行する"
    - id: "UC-007"
      name: "返却を実行する"
      actors: ["ACTOR-002"]
      screens: ["SCR-006"]
      events: ["EVT-002"]
      traces_to: ["BUC-006"]
      description: "司書が返却処理を実行し、蔵書の状態を更新する。予約がある場合は予約者へ通知する"
    - id: "UC-008"
      name: "貸出期間を延長する"
      actors: ["ACTOR-001"]
      screens: ["SCR-007"]
      events: []
      traces_to: ["BUC-007"]
      description: "一般会員が貸出中の図書の貸出期間延長を申請する"
    - id: "UC-009"
      name: "貸出状況を一覧表示する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007", "SCR-008"]
      events: []
      traces_to: ["BUC-008"]
      description: "自身の貸出一覧（一般会員）または全体の貸出一覧（司書）を表示する"
    - id: "UC-010"
      name: "延滞通知を送信する"
      actors: ["ACTOR-002"]
      screens: []
      events: ["EVT-003"]
      traces_to: ["BUC-008"]
      description: "貸出期限を超過した貸出に対して延滞通知を自動送信する"
  screens:
    - id: "SCR-005"
      name: "貸出処理画面"
      description: "会員IDと蔵書IDを入力し、貸出処理を実行する画面"
      information: ["INFO-001", "INFO-002", "INFO-003"]
    - id: "SCR-006"
      name: "返却処理画面"
      description: "蔵書IDを入力し、返却処理を実行する画面"
      information: ["INFO-001", "INFO-002"]
    - id: "SCR-007"
      name: "マイページ（貸出状況）"
      description: "一般会員が自身の貸出中図書一覧と延長操作を行う画面"
      information: ["INFO-002", "INFO-003"]
    - id: "SCR-008"
      name: "貸出管理一覧画面"
      description: "司書が全貸出状況を確認・管理する画面"
      information: ["INFO-002", "INFO-003"]
  events:
    - id: "EVT-002"
      name: "返却時予約通知トリガー"
      trigger: "返却処理完了時に対象蔵書に予約が存在する場合"
      description: "返却された蔵書に予約がある場合、予約者への通知をトリガーする"
    - id: "EVT-003"
      name: "延滞チェックバッチ"
      trigger: "日次バッチ処理（毎日AM9:00）"
      description: "貸出期限を超過した貸出レコードを検出し、延滞通知メールを送信する"

# システムレイヤー
system:
  information: ["INFO-001", "INFO-002", "INFO-003"]
  states: ["STATE-001", "STATE-002"]
  conditions:
    - id: "COND-003"
      name: "貸出可能条件"
      description: "対象蔵書が「利用可能」状態であり、会員の貸出上限数に達していないこと"
      traces_to: ["UC-006"]
    - id: "COND-004"
      name: "延長可能条件"
      description: "対象蔵書に予約が入っておらず、延長回数が上限（1回）に達していないこと"
      traces_to: ["UC-008"]
  variations:
    - id: "VAR-002"
      name: "貸出期間"
      values: ["2週間（一般書）", "1週間（雑誌）"]
      description: "蔵書カテゴリに応じた貸出期間の違い"
      traces_to: ["UC-006"]
---

# 貸出管理コンテキスト

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 一般会員"]
    actor2["ACTOR-002: 司書"]

    subgraph biz2["BIZ-002: 貸出管理"]
        buc5["BUC-005: 図書を貸し出す"]
        buc6["BUC-006: 図書を返却する"]
        buc7["BUC-007: 貸出期間を延長する"]
        buc8["BUC-008: 貸出状況を確認する"]
    end

    actor1 --> buc5
    actor1 --> buc7
    actor1 --> buc8
    actor2 --> buc5
    actor2 --> buc6
    actor2 --> buc8
```

## 業務フロー

### BUC-005: 図書を貸し出す

```mermaid
sequenceDiagram
    actor Member as 一般会員
    actor Librarian as 司書
    participant S as 図書館管理システム

    Member->>Librarian: 貸出を依頼
    Librarian->>S: 会員IDと蔵書IDを入力
    activate S
    S->>S: 貸出可能条件を確認
    alt 貸出可能
        S-->>Librarian: 貸出処理完了（貸出期限を表示）
        Librarian-->>Member: 図書を手渡し
    else 貸出不可（上限到達/蔵書利用不可）
        S-->>Librarian: エラーメッセージを表示
        Librarian-->>Member: 貸出不可を伝える
    end
    deactivate S
```

### BUC-006: 図書を返却する

```mermaid
sequenceDiagram
    actor Member as 一般会員
    actor Librarian as 司書
    participant S as 図書館管理システム

    Member->>Librarian: 図書を返却
    Librarian->>S: 蔵書IDを入力して返却処理
    activate S
    S->>S: 返却処理・延滞チェック
    alt 予約あり
        S->>S: 予約者へ通知送信
        S-->>Librarian: 返却完了（予約者通知済み）
    else 予約なし
        S-->>Librarian: 返却完了
    end
    deactivate S
```

### BUC-007: 貸出期間を延長する

```mermaid
sequenceDiagram
    actor Member as 一般会員
    participant S as 図書館管理システム

    Member->>S: 延長対象の貸出を選択
    activate S
    S->>S: 延長可能条件を確認
    alt 延長可能
        S-->>Member: 延長完了（新しい返却期限を表示）
    else 延長不可（予約あり/延長上限）
        S-->>Member: 延長不可の理由を表示
    end
    deactivate S
```

## ロバストネス図

### UC-006: 貸出を実行する

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    actor["ACTOR-002: 司書"]

    subgraph boundarySg["バウンダリ"]
        scr5["SCR-005: 貸出処理画面"]:::boundary
        btn1["貸出実行ボタン"]:::boundary
    end

    subgraph controlSg["コントローラ"]
        ctrl1["UC-006: 貸出を実行する"]:::control
    end

    subgraph entitySg["エンティティ"]
        info1[("INFO-001: 蔵書")]:::entity
        info2[("INFO-002: 貸出")]:::entity
        info3[("INFO-003: 会員")]:::entity
    end

    actor --> btn1
    btn1 --> ctrl1
    ctrl1 --> info1
    ctrl1 --> info2
    ctrl1 --> info3
    scr5 -.- ctrl1
```

### UC-007: 返却を実行する

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    actor["ACTOR-002: 司書"]

    subgraph boundarySg["バウンダリ"]
        scr6["SCR-006: 返却処理画面"]:::boundary
        btn1["返却実行ボタン"]:::boundary
    end

    subgraph controlSg["コントローラ"]
        ctrl1["UC-007: 返却を実行する"]:::control
    end

    subgraph entitySg["エンティティ"]
        info1[("INFO-001: 蔵書")]:::entity
        info2[("INFO-002: 貸出")]:::entity
        info4[("INFO-004: 予約")]:::entity
    end

    actor --> btn1
    btn1 --> ctrl1
    ctrl1 --> info1
    ctrl1 --> info2
    ctrl1 --> info4
    scr6 -.- ctrl1
```
