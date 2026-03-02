// use-cache-handler.mjs
import { createUseCacheHandler } from '@pantheon-systems/nextjs-cache-handler';

globalThis.__pantheonSurrogateKeyTags = globalThis.__pantheonSurrogateKeyTags || [];

const UseCacheHandlerClass = createUseCacheHandler({
  type: 'auto',
});

const handler = new UseCacheHandlerClass();

export default {
  get: handler.get.bind(handler),
  set: handler.set.bind(handler),
  refreshTags: handler.refreshTags.bind(handler),
  getExpiration: handler.getExpiration.bind(handler),
  updateTags: handler.updateTags.bind(handler),
};
