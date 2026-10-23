import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';

// Tests run inside the Compose network, where the public host (localhost:9000)
// is unreachable — presigned "public" URLs are signed for the internal endpoint.
export function storageTestConfig(): ConfigType<typeof storageConfig> {
  const base = storageConfig();
  return { ...base, publicEndpoint: base.endpoint };
}
