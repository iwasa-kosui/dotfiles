---
type: rdra-state-models
models:
  - id: "STATE-001"
    entity: "INFO-001"
    name: "蔵書状態"
    description: "蔵書のライフサイクル状態を管理する。登録から除籍までの状態遷移を定義"
    states:
      - name: "利用可能"
        description: "貸出・予約が可能な状態"
      - name: "貸出中"
        description: "現在貸し出されている状態"
      - name: "取置き中"
        description: "返却済みで予約者の取りに来るのを待っている状態"
      - name: "除籍済み"
        description: "除籍処理が完了し、利用不可となった状態"
    transitions:
      - from: "利用可能"
        to: "貸出中"
        trigger: "UC-006"
        condition: "貸出可能条件（COND-003）を満たすこと"
      - from: "貸出中"
        to: "利用可能"
        trigger: "UC-007"
        condition: "返却時に予約がないこと"
      - from: "貸出中"
        to: "取置き中"
        trigger: "UC-007"
        condition: "返却時に予約があること"
      - from: "取置き中"
        to: "貸出中"
        trigger: "UC-006"
        condition: "予約者への貸出処理"
      - from: "取置き中"
        to: "利用可能"
        trigger: "EVT-005"
        condition: "取置き期限超過で次の予約者がいない場合"
      - from: "取置き中"
        to: "取置き中"
        trigger: "EVT-005"
        condition: "取置き期限超過で次の予約者がいる場合（次の予約者に切替）"
      - from: "利用可能"
        to: "除籍済み"
        trigger: "UC-004"
        condition: "除籍可能条件（COND-002）を満たすこと"
    traces_to: ["UC-004", "UC-006", "UC-007"]

  - id: "STATE-002"
    entity: "INFO-002"
    name: "貸出状態"
    description: "貸出レコードのライフサイクル状態を管理する"
    states:
      - name: "貸出中"
        description: "図書が貸し出されている状態"
      - name: "延滞"
        description: "返却期限を超過している状態"
      - name: "返却済み"
        description: "図書が返却された状態"
    transitions:
      - from: "貸出中"
        to: "返却済み"
        trigger: "UC-007"
        condition: "返却処理実行"
      - from: "貸出中"
        to: "延滞"
        trigger: "EVT-003"
        condition: "返却期限を超過した場合"
      - from: "延滞"
        to: "返却済み"
        trigger: "UC-007"
        condition: "延滞図書の返却処理実行"
    traces_to: ["UC-006", "UC-007", "UC-008", "UC-010"]

  - id: "STATE-003"
    entity: "INFO-004"
    name: "予約状態"
    description: "予約レコードのライフサイクル状態を管理する"
    states:
      - name: "予約待ち"
        description: "対象蔵書が貸出中で、返却を待っている状態"
      - name: "取置き中"
        description: "対象蔵書が返却され、予約者が取りに来るのを待っている状態"
      - name: "完了"
        description: "予約図書の貸出が完了した状態"
      - name: "キャンセル済み"
        description: "予約者または期限切れによりキャンセルされた状態"
    transitions:
      - from: "予約待ち"
        to: "取置き中"
        trigger: "UC-013"
        condition: "予約順位1位で対象蔵書が返却された場合"
      - from: "予約待ち"
        to: "キャンセル済み"
        trigger: "UC-012"
        condition: "予約者による取消"
      - from: "取置き中"
        to: "完了"
        trigger: "UC-006"
        condition: "予約者への貸出処理完了"
      - from: "取置き中"
        to: "キャンセル済み"
        trigger: "EVT-005"
        condition: "取置き期限超過"
      - from: "取置き中"
        to: "キャンセル済み"
        trigger: "UC-012"
        condition: "予約者による取消"
    traces_to: ["UC-011", "UC-012", "UC-013", "UC-015"]
---

# 状態モデル（コンテキスト横断）

## STATE-001: 蔵書状態

```mermaid
stateDiagram-v2
    [*] --> 利用可能 : 蔵書登録 [UC-002]
    利用可能 --> 貸出中 : 貸出実行 [UC-006]
    貸出中 --> 利用可能 : 返却（予約なし）[UC-007]
    貸出中 --> 取置き中 : 返却（予約あり）[UC-007]
    取置き中 --> 貸出中 : 予約者への貸出 [UC-006]
    取置き中 --> 利用可能 : 期限切れ（次の予約なし）[EVT-005]
    取置き中 --> 取置き中 : 期限切れ（次の予約あり）[EVT-005]
    利用可能 --> 除籍済み : 除籍処理 [UC-004]
    除籍済み --> [*]
```

## STATE-002: 貸出状態

```mermaid
stateDiagram-v2
    [*] --> 貸出中 : 貸出実行 [UC-006]
    貸出中 --> 返却済み : 返却処理 [UC-007]
    貸出中 --> 延滞 : 期限超過 [EVT-003]
    延滞 --> 返却済み : 返却処理 [UC-007]
    返却済み --> [*]
```

## STATE-003: 予約状態

```mermaid
stateDiagram-v2
    [*] --> 予約待ち : 予約登録 [UC-011]
    予約待ち --> 取置き中 : 返却通知 [UC-013]
    予約待ち --> キャンセル済み : 予約取消 [UC-012]
    取置き中 --> 完了 : 貸出実行 [UC-006]
    取置き中 --> キャンセル済み : 期限切れ [EVT-005]
    取置き中 --> キャンセル済み : 予約取消 [UC-012]
    完了 --> [*]
    キャンセル済み --> [*]
```

## 状態モデル一覧

| ID | 対象エンティティ | 状態数 | 関連UC/EVT |
|----|----------------|--------|-----------|
| STATE-001 | 蔵書 (INFO-001) | 4 | UC-002, UC-004, UC-006, UC-007, EVT-005 |
| STATE-002 | 貸出 (INFO-002) | 3 | UC-006, UC-007, EVT-003 |
| STATE-003 | 予約 (INFO-004) | 4 | UC-006, UC-011, UC-012, UC-013, EVT-005 |
