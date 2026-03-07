---
type: rdra-context
id: "BIZ-001"
name: "collection-management"
display_name: "蔵書管理"

# システム価値レイヤー
value:
  goals: ["GOAL-001"]
  requirements:
    - id: "REQ-001"
      description: "司書がISBN等から書誌データを取得し、蔵書を迅速に登録できること"
      traces_to: ["GOAL-001"]
    - id: "REQ-002"
      description: "蔵書情報（所在、状態等）を随時更新できること"
      traces_to: ["GOAL-001"]
    - id: "REQ-003"
      description: "不要になった図書を除籍し、蔵書一覧から除外できること"
      traces_to: ["GOAL-001"]
    - id: "REQ-004"
      description: "一般会員・司書が蔵書をキーワード・カテゴリ等で検索できること"
      traces_to: ["GOAL-001"]

# 外部環境レイヤー
environment:
  business_usecases:
    - id: "BUC-001"
      name: "蔵書を登録する"
      actors: ["ACTOR-002", "ACTOR-003"]
      description: "司書がISBNを入力し、国立国会図書館APIから書誌データを取得して蔵書を登録する"
      traces_to: ["REQ-001"]
    - id: "BUC-002"
      name: "蔵書情報を更新する"
      actors: ["ACTOR-002"]
      description: "司書が蔵書の所在や状態等の情報を更新する"
      traces_to: ["REQ-002"]
    - id: "BUC-003"
      name: "蔵書を除籍する"
      actors: ["ACTOR-002"]
      description: "司書が不要な図書を除籍処理し、蔵書一覧から除外する"
      traces_to: ["REQ-003"]
    - id: "BUC-004"
      name: "蔵書を検索する"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "利用者がキーワード・著者名・ISBN等で蔵書を検索し、詳細情報や貸出状況を確認する"
      traces_to: ["REQ-004"]

# システム境界レイヤー
boundary:
  usecases:
    - id: "UC-001"
      name: "ISBN検索で書誌データを取得する"
      actors: ["ACTOR-002"]
      screens: ["SCR-001"]
      events: ["EVT-001"]
      traces_to: ["BUC-001"]
      description: "司書がISBNを入力し、国立国会図書館APIから書誌データを取得して表示する"
    - id: "UC-002"
      name: "蔵書を新規登録する"
      actors: ["ACTOR-002"]
      screens: ["SCR-001", "SCR-002"]
      events: []
      traces_to: ["BUC-001"]
      description: "取得した書誌データを確認・補完し、蔵書として登録する"
    - id: "UC-003"
      name: "蔵書情報を編集する"
      actors: ["ACTOR-002"]
      screens: ["SCR-002"]
      events: []
      traces_to: ["BUC-002"]
      description: "蔵書の所在・状態等の情報を編集して保存する"
    - id: "UC-004"
      name: "蔵書を除籍する"
      actors: ["ACTOR-002"]
      screens: ["SCR-002"]
      events: []
      traces_to: ["BUC-003"]
      description: "対象の蔵書を除籍済みステータスに変更する"
    - id: "UC-005"
      name: "蔵書を検索・一覧表示する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-003", "SCR-004"]
      events: []
      traces_to: ["BUC-004"]
      description: "検索条件に合致する蔵書を一覧表示し、詳細画面へ遷移する"
  screens:
    - id: "SCR-001"
      name: "書誌データ取得画面"
      description: "ISBN入力と国立国会図書館APIからの書誌データ取得結果を表示する画面"
      information: ["INFO-001"]
    - id: "SCR-002"
      name: "蔵書登録・編集画面"
      description: "蔵書の詳細情報を入力・編集する画面"
      information: ["INFO-001"]
    - id: "SCR-003"
      name: "蔵書検索画面"
      description: "キーワード・著者名・ISBN・カテゴリ等の検索条件を入力する画面"
      information: ["INFO-001"]
    - id: "SCR-004"
      name: "蔵書詳細画面"
      description: "蔵書の詳細情報と貸出状況を表示する画面"
      information: ["INFO-001", "INFO-002"]
  events:
    - id: "EVT-001"
      name: "書誌データAPI応答"
      trigger: "UC-001でISBN検索リクエストを送信した際のAPI応答"
      description: "国立国会図書館APIから書誌データ（タイトル、著者、出版社、出版年等）を受信する"

# システムレイヤー
system:
  information: ["INFO-001"]
  states: ["STATE-001"]
  conditions:
    - id: "COND-001"
      name: "ISBN形式チェック"
      description: "入力されたISBNが有効な形式（ISBN-10またはISBN-13）であること"
      traces_to: ["UC-001"]
    - id: "COND-002"
      name: "除籍可能条件"
      description: "対象蔵書が貸出中でなく、予約も入っていないこと"
      traces_to: ["UC-004"]
  variations:
    - id: "VAR-001"
      name: "蔵書カテゴリ"
      values: ["技術書", "ビジネス書", "一般書", "雑誌", "その他"]
      description: "蔵書を分類するカテゴリ種別"
      traces_to: ["UC-002"]
---

# 蔵書管理コンテキスト

## ビジネスコンテキスト図

```mermaid
graph LR
    actor2["ACTOR-002: 司書"]
    actor1["ACTOR-001: 一般会員"]
    ext1["ACTOR-003: NDL書誌データAPI"]

    subgraph biz1["BIZ-001: 蔵書管理"]
        buc1["BUC-001: 蔵書を登録する"]
        buc2["BUC-002: 蔵書情報を更新する"]
        buc3["BUC-003: 蔵書を除籍する"]
        buc4["BUC-004: 蔵書を検索する"]
    end

    actor2 --> buc1
    actor2 --> buc2
    actor2 --> buc3
    actor2 --> buc4
    actor1 --> buc4
    ext1 <--> buc1
```

## 業務フロー

### BUC-001: 蔵書を登録する

```mermaid
sequenceDiagram
    actor Librarian as 司書
    participant S as 図書館管理システム
    participant NDL as NDL書誌データAPI

    Librarian->>S: ISBNを入力
    activate S
    S->>NDL: 書誌データ検索リクエスト
    NDL-->>S: 書誌データ返却
    S-->>Librarian: 書誌データを表示
    deactivate S

    alt 書誌データが見つかった場合
        Librarian->>S: 書誌データを確認し補足情報を入力
        S-->>Librarian: 登録完了を通知
    else 書誌データが見つからない場合
        Librarian->>S: 手動で書誌情報を入力
        S-->>Librarian: 登録完了を通知
    end
```

### BUC-004: 蔵書を検索する

```mermaid
sequenceDiagram
    actor User as 利用者
    participant S as 図書館管理システム

    User->>S: 検索条件を入力
    activate S
    S-->>User: 検索結果一覧を表示
    deactivate S
    User->>S: 蔵書を選択
    activate S
    S-->>User: 蔵書詳細・貸出状況を表示
    deactivate S
```

## ロバストネス図

### UC-001: ISBN検索で書誌データを取得する

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    actor["ACTOR-002: 司書"]

    subgraph boundarySg["バウンダリ"]
        scr1["SCR-001: 書誌データ取得画面"]:::boundary
        btn1["ISBN検索ボタン"]:::boundary
    end

    subgraph controlSg["コントローラ"]
        ctrl1["UC-001: ISBN検索で書誌データを取得する"]:::control
    end

    subgraph entitySg["エンティティ"]
        info1[("INFO-001: 蔵書")]:::entity
        ext1[("ACTOR-003: NDL API")]:::entity
    end

    actor --> btn1
    btn1 --> ctrl1
    ctrl1 --> ext1
    ext1 --> ctrl1
    ctrl1 --> info1
    scr1 -.- ctrl1
```

### UC-002: 蔵書を新規登録する

```mermaid
flowchart LR
    classDef boundary fill:#fff59d,stroke:#ffa000,stroke-width:2px
    classDef control fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    classDef entity fill:#e6ee9c,stroke:#4caf50,stroke-width:2px

    actor["ACTOR-002: 司書"]

    subgraph boundarySg["バウンダリ"]
        scr1["SCR-001: 書誌データ取得画面"]:::boundary
        scr2["SCR-002: 蔵書登録・編集画面"]:::boundary
        btn1["登録ボタン"]:::boundary
    end

    subgraph controlSg["コントローラ"]
        ctrl1["UC-002: 蔵書を新規登録する"]:::control
    end

    subgraph entitySg["エンティティ"]
        info1[("INFO-001: 蔵書")]:::entity
    end

    actor --> btn1
    btn1 --> ctrl1
    ctrl1 --> info1
    scr1 -.- ctrl1
    scr2 -.- ctrl1
```
