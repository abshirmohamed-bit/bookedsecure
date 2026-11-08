/**
 * Hands a question typed on Home to the Assistant page. It is only placed in
 * the message box: the owner still presses send, so nothing runs by itself.
 */
const KEY = "bookedsecure:assistant-draft";

export function saveAssistantDraft(text: string): void {
  try {
    window.sessionStorage.setItem(KEY, text.slice(0, 2000));
  } catch {
    /* storage unavailable: the Assistant opens empty */
  }
}

export function takeAssistantDraft(): string {
  try {
    const text = window.sessionStorage.getItem(KEY) ?? "";
    window.sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return "";
  }
}
