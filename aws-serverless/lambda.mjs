import serverlessExpress from '@codegenie/serverless-express';
import app from '../src/server/index.js';
import { drainQueue } from '../src/server/ai/taggingWorker.js';
import { flushBroadcasts } from '../src/server/socket.js';

let serverlessExpressInstance;

async function setup(event, context) {
  serverlessExpressInstance = serverlessExpress({ app });
  return serverlessExpressInstance(event, context);
}

export const handler = async (event, context) => {
  const result = serverlessExpressInstance
    ? await serverlessExpressInstance(event, context)
    : await setup(event, context);

  // Express has sent the response, but background AI tagging jobs and real-time
  // broadcasts (wish:created, sys:log, …) are fired without await inside route
  // handlers. Drain both before returning so Lambda does not freeze mid-flight
  // and drop outbound Gemini/API Gateway requests.
  await drainQueue();
  await flushBroadcasts();

  return result;
};
