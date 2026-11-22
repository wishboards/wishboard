import serverlessExpress from '@codegenie/serverless-express';
import app from '../src/server/index.js';
import {
  ASYNC_TAGGING_EVENT_KEY,
  drainQueue,
  processWishJob,
} from '../src/server/ai/taggingWorker.js';
import { flushBroadcasts } from '../src/server/socket.js';

let serverlessExpressInstance;

async function setup(event, context) {
  serverlessExpressInstance = serverlessExpress({ app });
  return serverlessExpressInstance(event, context);
}

export const handler = async (event, context) => {
  // Handle asynchronous self-invoked AI tagging events outside the HTTP request path.
  if (event?.[ASYNC_TAGGING_EVENT_KEY] === 'aiTagging' && event.payload) {
    await processWishJob(event.payload);
    return { statusCode: 200, ok: true };
  }

  const result = serverlessExpressInstance
    ? await serverlessExpressInstance(event, context)
    : await setup(event, context);

  // Express has sent the response, but async Lambda event dispatches and real-time
  // broadcasts (wish:created, sys:log, …) are fired without await inside route
  // handlers. Drain both before returning so Lambda does not freeze mid-dispatch.
  await drainQueue();
  await flushBroadcasts();

  return result;
};
