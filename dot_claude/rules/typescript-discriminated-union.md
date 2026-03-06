---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript: 状態依存プロパティにはDiscriminated Unionを使う

## ルール

型の中でステータスやブール値によって他のプロパティの有無が変わる場合、オプショナルプロパティ（`?`）ではなくDiscriminated Unionで表現すること。

**理由**: オプショナルプロパティは不正な状態の組み合わせをコンパイル時に検出できない。Discriminated Unionなら型システムが不正な状態を排除し、switch/ifでの網羅性チェック（exhaustiveness check）も効く。

## 適用基準

以下のいずれかに該当する場合、Discriminated Unionを使う:

- ステータス（`status`, `state`, `type`, `kind`）によって持つべきプロパティが異なる
- ブール値（`isLoaded`, `isError`, `isAuthenticated` 等）によって関連データの有無が変わる
- 成功/失敗、ログイン/未ログインなど二項対立の状態を表す

## 悪い例

```typescript
// ❌ オプショナルプロパティによる表現
type Request = {
  status: "idle" | "loading" | "success" | "error";
  data?: ResponseData;  // successの時だけ存在
  error?: Error;        // errorの時だけ存在
};

// ❌ ブール値 + オプショナル
type User = {
  isAuthenticated: boolean;
  token?: string;       // trueの時だけ存在
  loginError?: string;  // falseの時だけ存在
};
```

## 良い例

```typescript
// ✅ Discriminated Union
type Request =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: ResponseData }
  | { status: "error"; error: Error };

// ✅ ブール値の代わりにリテラル型で判別
type User =
  | { kind: "authenticated"; token: string }
  | { kind: "anonymous"; loginError?: string };
```

## 例外

- 判別フィールドと無関係に本当にオプショナルなプロパティ（例: `nickname?: string`）はそのままでよい
- 外部APIのレスポンス型など、自分で制御できない型定義はこのルールの対象外
