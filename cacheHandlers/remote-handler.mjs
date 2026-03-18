import { createUseCacheHandler } from '@pantheon-systems/nextjs-cache-handler';

const UseCacheHandler = createUseCacheHandler({
  type: 'auto',
});

export default new UseCacheHandler();
