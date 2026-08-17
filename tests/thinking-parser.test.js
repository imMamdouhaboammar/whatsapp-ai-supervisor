import test from 'node:test';
import assert from 'node:assert/strict';
import { extractThinkingAndCleanText, parseDecisionJson, validateDecision } from '../src/ai/thinking-parser.js';

test('extracts <thinking> tags and separates clean decision JSON', () => {
  const raw = `<thinking>Customer is asking about working hours. Our policy permits auto-reply with hours.</thinking>
  \`\`\`json
  {
    "intent": "working_hours",
    "confidence": 0.98,
    "reply": "نحن نعمل من 9 صباحاً حتى 5 مساءً.",
    "requestedAction": "reply"
  }
  \`\`\``;

  const parsed = parseDecisionJson(raw);
  assert.equal(parsed.intent, 'working_hours');
  assert.equal(parsed.confidence, 0.98);
  assert.equal(parsed.thinking, 'Customer is asking about working hours. Our policy permits auto-reply with hours.');
  assert.equal(parsed.requestedAction, 'reply');

  const validated = validateDecision(parsed);
  assert.equal(validated.intent, 'working_hours');
  assert.equal(validated.thinking, 'Customer is asking about working hours. Our policy permits auto-reply with hours.');
});

test('handles raw JSON with reasoning_content and proactiveOffer', () => {
  const raw = JSON.stringify({
    intent: 'pricing',
    confidence: 0.91,
    reply: 'سعر الخدمة 500 جنيه، هل ترغب بتسجيل الحجز؟',
    requestedAction: 'reply',
    thinking: 'Analyzed price sheet. Proactively offered booking step.',
    proactiveOffer: 'offer_booking'
  });

  const parsed = parseDecisionJson(raw);
  const validated = validateDecision(parsed);
  assert.equal(validated.intent, 'pricing');
  assert.equal(validated.proactiveOffer, 'offer_booking');
  assert.equal(validated.thinking, 'Analyzed price sheet. Proactively offered booking step.');
});

test('rejects invalid action or malformed confidence', () => {
  assert.throws(() => validateDecision({
    intent: 'faq',
    confidence: 1.5,
    reply: 'ok',
    requestedAction: 'reply'
  }), /confidence/);

  assert.throws(() => validateDecision({
    intent: 'faq',
    confidence: 0.9,
    reply: 'ok',
    requestedAction: 'super_admin_action'
  }), /requestedAction/);
});
