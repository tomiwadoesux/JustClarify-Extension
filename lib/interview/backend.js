// Chooses where the interview keeps its data, and builds the one engine the
// routes share.
//
// Normally that is Supabase (store.js). With JC_IV_MEMORY=1 on a development
// server it is the in-memory store instead, so the page and the board can be
// run end to end without the live database:
//
//   JC_IV_MEMORY=1 npm run dev      then open /interview?c=local
//
// Memory mode is refused in production no matter what the variable says. It
// forgets everything on restart and has one share link, "local".

import { createEngine } from './engine.mjs';
import { createLlm } from './llm.mjs';
import { createMemStore } from './memstore.mjs';
import {
  interviewStore,
  interviewAdmin,
  interviewEnabledFlag,
  setInterviewEnabled,
  interviewKeepAlive,
} from './store';

export const memoryMode =
  process.env.JC_IV_MEMORY === '1' && process.env.NODE_ENV !== 'production';

const UUID_RE = interviewAdmin.UUID_RE;

function memoryBackend() {
  // On globalThis so the dev server's hot reload does not wipe it mid-interview.
  const state = (globalThis.__jcInterviewMemory ||= {
    store: createMemStore({ links: { local: { label: 'Local test link', max_sessions: 500 } } }),
    enabled: true,
  });
  return {
    store: state.store,
    admin: { UUID_RE, ...state.store.admin },
    enabledFlag: async () => state.enabled,
    setEnabled: async (on) => {
      state.enabled = !!on;
    },
    keepAlive: async () => ({ at: new Date().toISOString(), swept: 0 }),
  };
}

const backend = memoryMode
  ? memoryBackend()
  : {
      store: interviewStore,
      admin: interviewAdmin,
      enabledFlag: interviewEnabledFlag,
      setEnabled: setInterviewEnabled,
      keepAlive: interviewKeepAlive,
    };

export const store = backend.store;
export const admin = backend.admin;
export const enabledFlag = backend.enabledFlag;
export const setEnabled = backend.setEnabled;
export const keepAlive = backend.keepAlive;

export const interviewEngine = createEngine({ store, llm: createLlm() });
