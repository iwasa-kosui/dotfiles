---
type: rdra-information-model
entities:
  - id: "INFO-001"
    name: "蔵書"
    description: "図書館が所有する図書の情報。書誌データと管理情報を含む"
    attributes:
      - name: "蔵書ID"
        type: "string"
        required: true
        description: "蔵書を一意に識別するID"
      - name: "ISBN"
        type: "string"
        required: false
        description: "ISBN-10またはISBN-13"
      - name: "タイトル"
        type: "string"
        required: true
        description: "図書のタイトル"
      - name: "著者"
        type: "string"
        required: true
        description: "著者名"
      - name: "出版社"
        type: "string"
        required: false
        description: "出版社名"
      - name: "出版年"
        type: "integer"
        required: false
        description: "出版年"
      - name: "カテゴリ"
        type: "string"
        required: true
        description: "蔵書カテゴリ（VAR-001参照）"
      - name: "所在"
        type: "string"
        required: true
        description: "図書の所在場所（棚番号等）"
      - name: "状態"
        type: "string"
        required: true
        description: "蔵書の状態（STATE-001参照）"
      - name: "登録日"
        type: "date"
        required: true
        description: "蔵書として登録した日付"
    relations:
      - target: "INFO-002"
        type: "1:N"
        label: "貸し出される"
      - target: "INFO-004"
        type: "1:N"
        label: "予約される"
    traces_to: ["UC-001", "UC-002", "UC-003", "UC-004", "UC-005", "SCR-001", "SCR-002", "SCR-003", "SCR-004"]

  - id: "INFO-002"
    name: "貸出"
    description: "蔵書の貸出記録。貸出日・返却期限・返却日・延長回数を管理する"
    attributes:
      - name: "貸出ID"
        type: "string"
        required: true
        description: "貸出を一意に識別するID"
      - name: "蔵書ID"
        type: "string"
        required: true
        description: "貸出対象の蔵書ID（INFO-001への外部キー）"
      - name: "会員ID"
        type: "string"
        required: true
        description: "貸出者の会員ID（INFO-003への外部キー）"
      - name: "貸出日"
        type: "date"
        required: true
        description: "貸出処理を行った日付"
      - name: "返却期限"
        type: "date"
        required: true
        description: "返却期限日"
      - name: "返却日"
        type: "date"
        required: false
        description: "実際に返却された日付（未返却の場合はnull）"
      - name: "延長回数"
        type: "integer"
        required: true
        description: "貸出期間の延長回数（上限1回）"
      - name: "状態"
        type: "string"
        required: true
        description: "貸出の状態（STATE-002参照）"
    relations:
      - target: "INFO-001"
        type: "N:1"
        label: "対象蔵書"
      - target: "INFO-003"
        type: "N:1"
        label: "借りた会員"
    traces_to: ["UC-006", "UC-007", "UC-008", "UC-009", "SCR-005", "SCR-006", "SCR-007", "SCR-008"]

  - id: "INFO-003"
    name: "会員"
    description: "図書館の利用者情報。一般会員と司書の両方を含む"
    attributes:
      - name: "会員ID"
        type: "string"
        required: true
        description: "会員を一意に識別するID"
      - name: "氏名"
        type: "string"
        required: true
        description: "会員の氏名"
      - name: "メールアドレス"
        type: "string"
        required: true
        description: "通知送信先メールアドレス"
      - name: "会員種別"
        type: "string"
        required: true
        description: "一般会員 or 司書"
      - name: "貸出上限数"
        type: "integer"
        required: true
        description: "同時に貸出可能な最大冊数（デフォルト: 5）"
      - name: "予約上限数"
        type: "integer"
        required: true
        description: "同時に予約可能な最大件数（デフォルト: 3）"
    relations:
      - target: "INFO-002"
        type: "1:N"
        label: "借りる"
      - target: "INFO-004"
        type: "1:N"
        label: "予約する"
    traces_to: ["UC-006", "UC-009", "UC-011", "SCR-005", "SCR-008", "SCR-010"]

  - id: "INFO-004"
    name: "予約"
    description: "貸出中の蔵書に対する予約情報。予約順位と取置き期限を管理する"
    attributes:
      - name: "予約ID"
        type: "string"
        required: true
        description: "予約を一意に識別するID"
      - name: "蔵書ID"
        type: "string"
        required: true
        description: "予約対象の蔵書ID（INFO-001への外部キー）"
      - name: "会員ID"
        type: "string"
        required: true
        description: "予約者の会員ID（INFO-003への外部キー）"
      - name: "予約日"
        type: "datetime"
        required: true
        description: "予約登録日時（順位決定に使用）"
      - name: "予約順位"
        type: "integer"
        required: true
        description: "同一蔵書内の予約順位（1始まり）"
      - name: "取置き期限"
        type: "date"
        required: false
        description: "取置き期限日（取置き通知送信時に設定、3日間）"
      - name: "状態"
        type: "string"
        required: true
        description: "予約の状態（STATE-003参照）"
    relations:
      - target: "INFO-001"
        type: "N:1"
        label: "対象蔵書"
      - target: "INFO-003"
        type: "N:1"
        label: "予約した会員"
    traces_to: ["UC-011", "UC-012", "UC-013", "UC-014", "UC-015", "SCR-009", "SCR-010"]
---

# 情報モデル（コンテキスト横断）

## ER図

```mermaid
erDiagram
    BOOK ||--o{ LENDING : "貸し出される"
    BOOK ||--o{ RESERVATION : "予約される"
    MEMBER ||--o{ LENDING : "借りる"
    MEMBER ||--o{ RESERVATION : "予約する"

    BOOK {
        string book_id PK "蔵書ID"
        string isbn "ISBN"
        string title "タイトル"
        string author "著者"
        string publisher "出版社"
        int publish_year "出版年"
        string category "カテゴリ"
        string location "所在"
        string status "状態"
        date registered_at "登録日"
    }

    LENDING {
        string lending_id PK "貸出ID"
        string book_id FK "蔵書ID"
        string member_id FK "会員ID"
        date lent_at "貸出日"
        date due_date "返却期限"
        date returned_at "返却日"
        int extension_count "延長回数"
        string status "状態"
    }

    MEMBER {
        string member_id PK "会員ID"
        string name "氏名"
        string email "メールアドレス"
        string member_type "会員種別"
        int lending_limit "貸出上限数"
        int reservation_limit "予約上限数"
    }

    RESERVATION {
        string reservation_id PK "予約ID"
        string book_id FK "蔵書ID"
        string member_id FK "会員ID"
        datetime reserved_at "予約日"
        int priority "予約順位"
        date hold_deadline "取置き期限"
        string status "状態"
    }
```

## エンティティ一覧

| ID | エンティティ名 | 参照コンテキスト |
|----|--------------|----------------|
| INFO-001 | 蔵書 | BIZ-001, BIZ-002, BIZ-003 |
| INFO-002 | 貸出 | BIZ-002 |
| INFO-003 | 会員 | BIZ-002, BIZ-003 |
| INFO-004 | 予約 | BIZ-002, BIZ-003 |
