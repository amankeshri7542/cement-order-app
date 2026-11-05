import { w } from '../words';
import { ApiError, message } from './api';
import { createStore } from '../logic/store-core';

export const netStore = createStore({ online: true });
export const isOnline = () => netStore.get().online;

/** Customer words for any failure. With no connection the plain cause is the useful one. */
export const say = (error: unknown) =>
  error instanceof ApiError && error.code === 'NETWORK_ERROR' && !isOnline()
    ? w('net.offline')
    : message(error);
