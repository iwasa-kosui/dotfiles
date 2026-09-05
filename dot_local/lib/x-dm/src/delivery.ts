export interface DeliverySnapshot {
  composer: string | null;
  messages: { id: string; text: string; sentByMe: boolean }[];
}

export class SendOutcomeUnknownError extends Error {
  readonly result;

  constructor(target: string, message: string) {
    super("送信結果を確認できません。再送せず、会話履歴で送信済みか確認してください");
    this.name = "SendOutcomeUnknownError";
    this.result = { success: false, outcome: "unknown", handle: `@${target}`, message, error: this.message } as const;
  }
}
