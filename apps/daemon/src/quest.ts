import { createQuestDaemon } from './daemon';
import { runMobileDaemon } from './mobile';

runMobileDaemon('android', createQuestDaemon);
