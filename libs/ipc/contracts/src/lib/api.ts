import type { RequestOf, ResponseOf } from './channel';
import type { ChannelKey, Channels } from './channels';

/** Объект `window.eow`, который preload выставляет в renderer. */
export type EowApi = {
  readonly [K in ChannelKey]: (request: RequestOf<Channels[K]>) => Promise<ResponseOf<Channels[K]>>;
};

/** Имя глобального объекта в renderer. */
export const EOW_API_KEY = 'eow';
