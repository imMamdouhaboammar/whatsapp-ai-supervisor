/**
 * Extracts thinking/reasoning blocks and parses structured decision payloads
 * from various LLM response formats (OpenAI, Anthropic Claude, AgentRouter, DeepSeek, etc.)
 */

export function extractThinkingAndCleanText(rawText) {
  if (typeof rawText !== 'string') return { thinking: null, cleanText: '' };

  let text = rawText.trim();
  let thinking = null;

  // Extract <thinking>...</thinking> or <thought>...</thought> tags
  const thinkingMatch = text.match(/<(?:thinking|thought)>([\s\S]*?)<\/(?:thinking|thought)>/i);
  if (thinkingMatch) {
    thinking = thinkingMatch[1].trim();
    text = text.replace(/<(?:thinking|thought)>[\s\S]*?<\/(?:thinking|thought)>/gi, '').trim();
  }

  return { thinking, cleanText: text };
}

export function parseDecisionJson(rawText) {
  const { thinking, cleanText } = extractThinkingAndCleanText(rawText);

  // If cleanText is enclosed in ```json ... ``` markdown block
  let jsonString = cleanText;
  const markdownMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdownMatch) {
    jsonString = markdownMatch[1].trim();
  } else {
    // Try to find the first '{' and last '}'
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonString = cleanText.slice(start, end + 1);
    }
  }

  const parsed = JSON.parse(jsonString);
  if (thinking && !parsed.thinking) {
    parsed.thinking = thinking;
  }
  return parsed;
}

export function validateDecision(value) {
  const allowed = new Set(['ignore', 'draft', 'reply', 'act', 'human']);
  if (!value || typeof value !== 'object') throw new Error('Invalid model decision: expected object');
  if (typeof value.intent !== 'string' || !value.intent.trim()) throw new Error('Invalid model decision: intent');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('Invalid model decision: confidence');
  if (typeof value.reply !== 'string') throw new Error('Invalid model decision: reply');
  if (!allowed.has(value.requestedAction)) throw new Error('Invalid model decision: requestedAction');

  return {
    intent: value.intent.trim(),
    confidence: value.confidence,
    reply: value.reply,
    requestedAction: value.requestedAction,
    thinking: typeof value.thinking === 'string' ? value.thinking.trim() : (value.reasoning_content ?? null),
    proactiveOffer: typeof value.proactiveOffer === 'string' ? value.proactiveOffer.trim() : null
  };
}
