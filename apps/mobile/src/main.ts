import '@/renderer/styles/globals.css';

import { Result } from 'better-result';

import { initialiseMobileBridge } from './bridge';

import { causeMessage, createProblem } from '@/lib/errors';
import { translate } from '@/lib/messages';

const initialised = await Result.tryPromise({
   try: initialiseMobileBridge,
   catch: (cause) => createProblem('mobile.start-failed', { cause: causeMessage(cause) })
});
const started = Result.flatten(initialised);
if (Result.isOk(started)) {
   await import('@/renderer/main');
} else {
   const root = document.getElementById('root');
   if (root) {
      const message = document.createElement('p');
      message.textContent = started.error.message;
      const retry = document.createElement('button');
      retry.textContent = translate('app.restart');
      retry.onclick = () => location.reload();
      root.style.padding = '2rem';
      root.append(message, retry);
   }
}
