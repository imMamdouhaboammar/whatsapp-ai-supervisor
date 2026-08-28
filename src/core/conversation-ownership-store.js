import { createInitialOwnership } from '../domain/conversation-ownership.js';

export function ownershipKey(tenantId, conversationId) {
  const tenant = String(tenantId ?? '').trim();
  const conversation = String(conversationId ?? '').trim();
  if (!tenant) throw new Error('ownership_tenant_id_required');
  if (!conversation) throw new Error('ownership_conversation_id_required');
  return `${tenant}:${conversation}`;
}

export function assertOwnershipTransitionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('ownership_transition_input_required');
  }
  ownershipKey(input.tenantId, input.conversationId);
  if (!String(input.command ?? '').trim()) throw new Error('ownership_command_required');
  if (!String(input.transitionId ?? '').trim()) throw new Error('ownership_transition_id_required');
  if (!String(input.actor ?? '').trim()) throw new Error('ownership_actor_required');
  if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
    const version = Number(input.expectedVersion);
    if (!Number.isInteger(version) || version < 0) throw new Error('ownership_expected_version_invalid');
  }
  return input;
}

export function defaultOwnershipFor(tenantId, conversationId, dependencies = {}) {
  ownershipKey(tenantId, conversationId);
  return createInitialOwnership({ tenantId, conversationId }, dependencies);
}

export class ConversationOwnershipStore {
  async get(_tenantId, _conversationId) {
    throw new Error('conversation_ownership_store_get_not_implemented');
  }

  async getMany(tenantId, conversationIds) {
    if (!Array.isArray(conversationIds)) throw new Error('ownership_conversation_ids_required');
    return Promise.all(conversationIds.map((conversationId) => this.get(tenantId, conversationId)));
  }

  async transition(_input) {
    throw new Error('conversation_ownership_store_transition_not_implemented');
  }
}
