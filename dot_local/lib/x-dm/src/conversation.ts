function uniqueIndex(matches: number[], description: string): number {
  if (matches.length === 0) throw new Error(`${description}が見つかりません`);
  if (matches.length > 1) throw new Error(`${description}に複数件が一致しました。宛先を絞り込んでください`);
  return matches[0];
}

export function findConversationIndex(names: string[], target: string): number {
  const matches = names.flatMap((name, index) =>
    name.toLowerCase().includes(target.toLowerCase()) ? [index] : [],
  );
  return uniqueIndex(matches, `会話「${target}」`);
}

export function findRecipientIndex(handles: string[], handle: string): number {
  const expected = `@${handle}`.toLowerCase();
  return uniqueIndex(handles.flatMap((value, index) => value.trim().toLowerCase() === expected ? [index] : []), `ユーザー @${handle}`);
}

export function parseConversation(href: string, text: string) {
  const match = text.match(/(\d+(?:秒|分|時間|日|週間|か月|年))/);
  return {
    id: href.replace("/i/chat/", ""),
    name: (match ? text.slice(0, match.index) : text).trim(),
    lastMessage: match ? text.slice(match.index! + match[0].length).trim() : "",
    timestamp: match?.[1] ?? "",
  };
}
