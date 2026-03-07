---
type: rdra-overview
project: "社内図書館管理システム"
actors:
  - id: "ACTOR-001"
    name: "一般会員"
    type: human
    description: "図書館を利用する社員。蔵書の検索・閲覧、貸出・返却、予約を行う"
  - id: "ACTOR-002"
    name: "司書"
    type: human
    description: "図書館の運営管理を担当する職員。蔵書管理、貸出管理、予約管理の全業務を遂行する"
  - id: "ACTOR-003"
    name: "国立国会図書館書誌データAPI"
    type: system
    description: "国立国会図書館が提供する書誌データ検索API。ISBN等から書誌情報を取得する"
goals:
  - id: "GOAL-001"
    name: "蔵書の効率的な管理"
    description: "蔵書の登録・更新・除籍を正確かつ効率的に行い、蔵書情報を常に最新に保つ"
    actors: ["ACTOR-002"]
  - id: "GOAL-002"
    name: "貸出・返却業務の円滑化"
    description: "貸出・返却の手続きをシステム化し、貸出状況をリアルタイムに把握できるようにする"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-003"
    name: "予約による利用機会の公平化"
    description: "貸出中の図書に対して予約を可能にし、利用機会を公平に提供する"
    actors: ["ACTOR-001", "ACTOR-002"]
contexts:
  - id: "BIZ-001"
    name: "collection-management"
    description: "蔵書の登録・更新・除籍および書誌データの外部連携を含む蔵書管理業務"
    primary_actors: ["ACTOR-002"]
    goals: ["GOAL-001"]
  - id: "BIZ-002"
    name: "lending-management"
    description: "図書の貸出・返却・延長および貸出状況の管理業務"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-002"]
  - id: "BIZ-003"
    name: "reservation-management"
    description: "貸出中図書の予約・予約取消・予約通知および予約状況の管理業務"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-003"]
---

# 社内図書館管理システム - 全体概観

## システムコンテキスト図

```mermaid
graph TB
    actor1["ACTOR-001: 一般会員"]
    actor2["ACTOR-002: 司書"]
    ext1["ACTOR-003: 国立国会図書館書誌データAPI"]
    system["社内図書館管理システム"]

    actor1 --> system
    actor2 --> system
    ext1 <--> system
```

## コンテキスト間関係図

```mermaid
graph LR
    subgraph biz1["BIZ-001: 蔵書管理"]
        b1["蔵書の登録・更新・除籍"]
    end
    subgraph biz2["BIZ-002: 貸出管理"]
        b2["貸出・返却・延長"]
    end
    subgraph biz3["BIZ-003: 予約管理"]
        b3["予約・取消・通知"]
    end

    biz1 --> biz2
    biz2 --> biz3
    biz3 --> biz2
```

## コンテキスト一覧

| ID | コンテキスト名 | 主要アクター | 関連ゴール |
|----|--------------|-------------|-----------|
| BIZ-001 | 蔵書管理 | 司書 | GOAL-001 |
| BIZ-002 | 貸出管理 | 一般会員, 司書 | GOAL-002 |
| BIZ-003 | 予約管理 | 一般会員, 司書 | GOAL-003 |
