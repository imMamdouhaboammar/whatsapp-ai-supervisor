import { WhatsAppCloudSender } from './whatsapp-cloud.js';
import { WhatsAppLinkedDeviceSender, whatsappTransportMode } from './whatsapp-linked-device.js';

export function createWhatsAppSender({ tenant, metaGraphVersion, resolveSecret, fetchImpl, linkedDeviceWorkerUrlOverride = null }) {
  const mode = whatsappTransportMode(tenant);
  if (mode === 'cloud') {
    const accessToken = resolveSecret(tenant.whatsapp ?? {}, 'accessTokenEnv', 'META_WHATSAPP_ACCESS_TOKEN');
    return new WhatsAppCloudSender({
      accessToken,
      phoneNumberId: tenant.phoneNumberId,
      graphVersion: metaGraphVersion,
      fetchImpl
    });
  }
  if (mode === 'linked-device') {
    const token = resolveSecret(tenant.whatsapp ?? {}, 'workerTokenEnv', 'WHATSAPP_LINKED_DEVICE_WORKER_TOKEN');
    return new WhatsAppLinkedDeviceSender({
      baseUrl: linkedDeviceWorkerUrlOverride ?? tenant.whatsapp.workerUrl,
      token,
      sessionId: tenant.whatsapp.sessionId,
      fetchImpl
    });
  }
  throw new Error(`Unsupported WhatsApp transport: ${mode}`);
}
