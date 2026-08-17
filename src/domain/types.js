export const AUTONOMY_ACTIONS = Object.freeze(['ignore', 'draft', 'reply', 'act', 'human']);

export function assertAutonomyAction(value) {
  if (!AUTONOMY_ACTIONS.includes(value)) {
    throw new Error(`Invalid autonomy action: ${value}`);
  }
  return value;
}
